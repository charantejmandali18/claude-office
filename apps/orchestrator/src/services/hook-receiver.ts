import http from 'http';
import { AgentStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { EventStream } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import { generateEventId, generateRunId } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';

/** Color palette for communication lines */
const LINE_COLORS = ['#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4', '#ec4899', '#22c55e'];

export class HookReceiver {
  private db: PrismaClient | null = null;

  /** Track active CEA→specialist collaborations: agentName → collabId */
  private activeCollabs = new Map<string, string>();

  /** Track active specialist↔specialist collaborations: "agentA↔agentB" → collabId */
  private peerCollabs = new Map<string, string>();

  /** Map internal agent IDs (a080e64ae...) to names (github-repos-owner) */
  private agentIdToName = new Map<string, string>();

  /** Agents that have been stopped (SubagentStop received) — re-spawn after stop = shutdown noise */
  private stoppedAgents = new Set<string>();

  /** Track which agents are currently active (between SubagentStart and SubagentStop) */
  private activeAgents = new Set<string>();

  private colorIndex = 0;

  constructor(private eventBus: EventBus) {}

  setDb(db: PrismaClient): void {
    this.db = db;
  }

  handler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return (req, res) => {
      if (req.method === 'POST' && req.url === '/hooks/event') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            this.processHook(payload).catch((err) => {
              console.error('[Hook] Error processing:', err);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
          } catch {
            res.writeHead(400);
            res.end('{"error":"invalid json"}');
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    };
  }

  private async processHook(payload: Record<string, unknown>): Promise<void> {
    const eventName = payload.hook_event_name as string;
    const sessionId = payload.session_id as string ?? '';
    const agentId = payload.agent_id as string ?? '';
    const toolName = payload.tool_name as string ?? '';

    switch (eventName) {
      case 'SessionStart': {
        const agentType = payload.agent_type as string ?? 'main';
        console.log(`[Hook] Session started: ${sessionId?.slice(0, 8)} type=${agentType}`);
        break;
      }

      case 'SessionEnd': {
        console.log(`[Hook] Session ended: ${sessionId?.slice(0, 8)}`);
        await this.cleanupAll();
        break;
      }

      case 'SubagentStart': {
        const agentType = payload.agent_type as string ?? '';
        const agentName = agentType || agentId;

        // Map internal ID → name
        if (agentId && agentType) {
          this.agentIdToName.set(agentId, agentType);
        }

        // FIX #1: SHUTDOWN RE-SPAWN DETECTION
        // If this agent was already stopped in this task cycle, this is a re-spawn for shutdown.
        // The team lead is re-spawning it just to shut it down — ignore completely.
        if (agentName && this.stoppedAgents.has(agentName)) {
          console.log(`[Hook] ⏭️  Ignoring shutdown re-spawn: ${agentName}`);
          break;
        }

        console.log(`[Hook] 🚀 Subagent START: ${agentName} session=${sessionId?.slice(0, 8)}`);

        this.activeAgents.add(agentName);

        // CEA is coordinating while teammates work
        await this.updateAgentStatus('cea', AgentStatus.THINKING);

        // Activate specialist in UI + draw CEA→specialist line
        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          await this.updateAgentStatus(agentName, AgentStatus.THINKING);

          const color = LINE_COLORS[this.colorIndex % LINE_COLORS.length];
          this.colorIndex++;
          const collabId = `hook-${agentName}-${Date.now()}`;
          this.activeCollabs.set(agentName, collabId);

          await this.emitCollaboration('start', 'cea', agentName, collabId, color);
        }
        break;
      }

      case 'SubagentStop': {
        const agentName = this.agentIdToName.get(agentId) ?? agentId;

        // If this was a shutdown re-spawn (agent already stopped), ignore silently
        if (agentName && this.stoppedAgents.has(agentName)) {
          console.log(`[Hook] ⏭️  Ignoring shutdown stop: ${agentName}`);
          this.agentIdToName.delete(agentId);
          break;
        }

        console.log(`[Hook] 🏁 Subagent STOP: ${agentName} session=${sessionId?.slice(0, 8)}`);

        // Mark as stopped so any re-spawn is detected as shutdown noise
        this.stoppedAgents.add(agentName);
        this.activeAgents.delete(agentName);

        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          // FIX #2: Set agent IDLE and end ALL lines involving this agent
          await this.updateAgentStatus(agentName, AgentStatus.IDLE);

          // End CEA→specialist line
          const collabId = this.activeCollabs.get(agentName);
          if (collabId) {
            this.activeCollabs.delete(agentName);
            await this.emitCollaboration('end', 'cea', agentName, collabId);
          }

          // End any peer lines involving this agent
          for (const [key, peerCollabId] of this.peerCollabs) {
            if (key.includes(agentName)) {
              this.peerCollabs.delete(key);
              const [a, b] = key.split('↔');
              await this.emitCollaboration('end', a, b, peerCollabId);
            }
          }

          // If ALL agents are now idle, set CEA to IDLE too
          if (this.activeAgents.size === 0) {
            console.log(`[Hook] ✅ All teammates done — CEA → IDLE`);
            await this.updateAgentStatus('cea', AgentStatus.IDLE);
            // Also clean up any orphaned collabs
            for (const [name, cid] of this.activeCollabs) {
              await this.emitCollaboration('end', 'cea', name, cid);
            }
            this.activeCollabs.clear();
          }
        }

        this.agentIdToName.delete(agentId);
        break;
      }

      case 'PreToolUse': {
        const resolvedName = this.agentIdToName.get(agentId) ?? agentId;

        // Team lead tool use
        if (!agentId && toolName) {
          await this.updateAgentStatus('cea', AgentStatus.TOOL_CALLING);
          break;
        }

        // Ignore events from stopped agents (shutdown re-spawn)
        if (this.stoppedAgents.has(resolvedName)) break;

        if (resolvedName && AGENT_ROLE_MAP.has(resolvedName)) {
          await this.updateAgentStatus(resolvedName, AgentStatus.TOOL_CALLING);
          await this.eventBus.publish({
            id: generateEventId(),
            agentId: resolvedName,
            runId: generateRunId(),
            seq: 1,
            stream: 'tool',
            timestamp: Date.now(),
            data: { tool: toolName, phase: 'start' },
          });
        }
        break;
      }

      case 'PostToolUse': {
        const resolvedName = this.agentIdToName.get(agentId) ?? agentId;

        // Team lead tool use
        if (!agentId && toolName) {
          await this.updateAgentStatus('cea', AgentStatus.THINKING);
          break;
        }

        // Ignore events from stopped agents (shutdown re-spawn)
        if (this.stoppedAgents.has(resolvedName)) break;

        if (resolvedName && AGENT_ROLE_MAP.has(resolvedName)) {
          await this.updateAgentStatus(resolvedName, AgentStatus.THINKING);
          await this.eventBus.publish({
            id: generateEventId(),
            agentId: resolvedName,
            runId: generateRunId(),
            seq: 1,
            stream: 'tool',
            timestamp: Date.now(),
            data: { tool: toolName, phase: 'end' },
          });
        }

        // FIX #3: INTER-AGENT COMMUNICATION VISUALIZATION
        if (toolName === 'SendMessage' && resolvedName) {
          const toolInput = payload.tool_input as Record<string, unknown> | undefined;
          const to = (toolInput?.to as string) ?? (toolInput?.recipient as string);
          if (to) {
            console.log(`[Hook] 💬 SendMessage: ${resolvedName} → ${to}`);

            // Draw a peer-to-peer line between the two specialists (skip team-lead messages)
            if (to !== 'team-lead' && to !== 'cea' && AGENT_ROLE_MAP.has(to)) {
              const peerKey = [resolvedName, to].sort().join('↔');
              if (!this.peerCollabs.has(peerKey)) {
                const color = LINE_COLORS[this.colorIndex % LINE_COLORS.length];
                this.colorIndex++;
                const peerCollabId = `peer-${peerKey}-${Date.now()}`;
                this.peerCollabs.set(peerKey, peerCollabId);
                await this.emitCollaboration('start', resolvedName, to, peerCollabId, color);
              }

              // Emit a message event on the existing line for speech bubbles
              const peerCollabId = this.peerCollabs.get(peerKey)!;
              await this.emitCollaborationMessage(resolvedName, to, peerCollabId);
            }
          }
        }
        break;
      }

      case 'Stop': {
        if (!agentId) {
          console.log(`[Hook] Team lead turn stopped (${this.activeAgents.size} active agents)`);
        }
        break;
      }

      case 'UserPromptSubmit': {
        console.log(`[Hook] User prompt submitted`);
        // Fresh task — reset all tracking
        this.stoppedAgents.clear();
        this.activeAgents.clear();
        this.colorIndex = 0;
        await this.updateAgentStatus('cea', AgentStatus.THINKING);
        break;
      }

      case 'Notification':
        break;

      default:
        console.log(`[Hook] Unhandled: ${eventName}`);
    }
  }

  /** Clean up all state (session ended) */
  private async cleanupAll(): Promise<void> {
    // End all CEA→specialist lines
    for (const [agentName, collabId] of this.activeCollabs) {
      await this.updateAgentStatus(agentName, AgentStatus.IDLE);
      await this.emitCollaboration('end', 'cea', agentName, collabId);
    }
    // End all peer lines
    for (const [key, collabId] of this.peerCollabs) {
      const [a, b] = key.split('↔');
      await this.emitCollaboration('end', a, b, collabId);
    }
    await this.updateAgentStatus('cea', AgentStatus.IDLE);
    this.activeCollabs.clear();
    this.peerCollabs.clear();
    this.agentIdToName.clear();
    this.stoppedAgents.clear();
    this.activeAgents.clear();
    this.colorIndex = 0;
  }

  /** Emit a collaboration line event (start or end) */
  private async emitCollaboration(
    phase: 'start' | 'end',
    from: string,
    to: string,
    collabId: string,
    color?: string,
  ): Promise<void> {
    const isPeer = from !== 'cea' && to !== 'cea';
    await this.eventBus.publish({
      id: generateEventId(),
      agentId: from,
      runId: generateRunId(),
      seq: 1,
      stream: 'collaboration' as EventStream,
      timestamp: Date.now(),
      data: {
        phase,
        collaborationId: collabId,
        ...(phase === 'start' ? {
          type: isPeer ? 'peer' : 'parallel',
          topic: isPeer ? `${from} ↔ ${to}` : `Working: ${to}`,
          color,
        } : {}),
        participants: [from, to],
      },
    });
  }

  /** Emit a message event on an existing collaboration (for speech bubbles) */
  private async emitCollaborationMessage(
    from: string,
    to: string,
    collabId: string,
  ): Promise<void> {
    await this.eventBus.publish({
      id: generateEventId(),
      agentId: from,
      runId: generateRunId(),
      seq: 1,
      stream: 'collaboration' as EventStream,
      timestamp: Date.now(),
      data: {
        phase: 'message',
        collaborationId: collabId,
        fromAgent: from,
        toAgent: to,
        participants: [from, to],
      },
    });
  }

  /** Update agent status in DB and broadcast via WebSocket */
  private async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    console.log(`[Hook] 📡 ${agentId} → ${status}`);
    if (this.db) {
      const roleMeta = AGENT_ROLE_MAP.get(agentId);
      if (roleMeta) {
        try {
          await this.db.agent.upsert({
            where: { configId: agentId },
            update: { status },
            create: {
              configId: agentId,
              name: roleMeta.name,
              role: roleMeta.role,
              icon: roleMeta.icon,
              status,
            },
          });
        } catch (err) {
          console.error(`[Hook] DB error for ${agentId}:`, err);
        }
      }
    }
    const phase = status === AgentStatus.IDLE ? 'end' : status === AgentStatus.THINKING ? 'thinking' : 'start';
    await this.eventBus.publish({
      id: generateEventId(),
      agentId,
      runId: generateRunId(),
      seq: 1,
      stream: 'lifecycle',
      timestamp: Date.now(),
      data: { phase },
    });
  }
}
