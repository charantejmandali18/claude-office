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

  /** Track active collaborations for line lifecycle: agentName → collabId */
  private activeCollabs = new Map<string, string>();

  /** Map internal agent IDs (a080e64ae...) to names (github-repos-owner) */
  private agentIdToName = new Map<string, string>();

  /** Agents that have reported back via SendMessage — any re-spawn after this is shutdown noise */
  private reportedAgents = new Set<string>();

  /** Agents currently in shutdown cycle — ignore all their events */
  private shutdownAgents = new Set<string>();

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
        this.cleanupAll();
        break;
      }

      case 'SubagentStart': {
        const agentType = payload.agent_type as string ?? '';
        const agentName = agentType || agentId;

        // Map internal ID → name
        if (agentId && agentType) {
          this.agentIdToName.set(agentId, agentType);
        }

        // SHUTDOWN DETECTION: if this agent already reported back, this is a shutdown re-spawn
        if (agentName && this.reportedAgents.has(agentName)) {
          this.shutdownAgents.add(agentName);
          this.shutdownAgents.add(agentId);
          console.log(`[Hook] ⏭️  Ignoring shutdown re-spawn: ${agentName}`);
          break; // Don't activate in UI, don't draw lines
        }

        console.log(`[Hook] 🚀 Subagent START: ${agentName} session=${sessionId?.slice(0, 8)}`);

        // CEA is coordinating while teammates work
        if (this.activeCollabs.size === 0) {
          await this.updateAgentStatus('cea', AgentStatus.THINKING);
        }

        // Activate specialist in UI + draw line
        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          await this.updateAgentStatus(agentName, AgentStatus.THINKING);

          const color = LINE_COLORS[this.colorIndex % LINE_COLORS.length];
          this.colorIndex++;
          const collabId = `hook-${agentName}-${Date.now()}`;
          this.activeCollabs.set(agentName, collabId);

          await this.emitCollaboration('start', agentName, collabId, color);
        }
        break;
      }

      case 'SubagentStop': {
        const agentName = this.agentIdToName.get(agentId) ?? agentId;

        // If this is a shutdown cycle agent, just clean up silently
        if (this.shutdownAgents.has(agentId) || this.shutdownAgents.has(agentName)) {
          console.log(`[Hook] ⏭️  Ignoring shutdown stop: ${agentName}`);
          this.shutdownAgents.delete(agentId);
          this.shutdownAgents.delete(agentName);
          this.agentIdToName.delete(agentId);
          break;
        }

        console.log(`[Hook] 🏁 Subagent STOP: ${agentName} session=${sessionId?.slice(0, 8)}`);

        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          // Set agent IDLE
          await this.updateAgentStatus(agentName, AgentStatus.IDLE);

          // End communication line
          const collabId = this.activeCollabs.get(agentName);
          if (collabId) {
            this.activeCollabs.delete(agentName);
            await this.emitCollaboration('end', agentName, collabId);
          }

          // If ALL agents are now idle, set CEA to IDLE
          if (this.activeCollabs.size === 0) {
            console.log(`[Hook] ✅ All teammates done — CEA → IDLE`);
            await this.updateAgentStatus('cea', AgentStatus.IDLE);
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

        // Ignore events from shutdown or already-reported agents
        if (this.isIgnored(agentId, resolvedName)) break;

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

        // Ignore events from shutdown or already-stopped agents
        if (this.isIgnored(agentId, resolvedName)) break;

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

        // Detect SendMessage — mark agent as having reported back
        if (toolName === 'SendMessage') {
          const toolInput = payload.tool_input as Record<string, unknown> | undefined;
          const to = (toolInput?.to as string) ?? (toolInput?.recipient as string);
          if (to && resolvedName) {
            console.log(`[Hook] 💬 SendMessage: ${resolvedName} → ${to}`);
            // If sending to team-lead, this agent has reported its results
            if (to === 'team-lead' || to === 'cea') {
              this.reportedAgents.add(resolvedName);
            }
          }
        }
        break;
      }

      case 'Stop': {
        if (!agentId) {
          console.log(`[Hook] Team lead turn stopped (${this.activeCollabs.size} active)`);
        }
        break;
      }

      case 'UserPromptSubmit': {
        console.log(`[Hook] User prompt submitted`);
        // Fresh task — reset reported agents tracking
        this.reportedAgents.clear();
        this.shutdownAgents.clear();
        await this.updateAgentStatus('cea', AgentStatus.THINKING);
        break;
      }

      case 'Notification':
        break;

      default:
        console.log(`[Hook] Unhandled: ${eventName}`);
    }
  }

  /** Check if events from this agent should be ignored */
  private isIgnored(agentId: string, resolvedName: string): boolean {
    return this.shutdownAgents.has(agentId) ||
           this.shutdownAgents.has(resolvedName);
  }

  /** Clean up all state (session ended) */
  private async cleanupAll(): Promise<void> {
    for (const [agentName, collabId] of this.activeCollabs) {
      await this.updateAgentStatus(agentName, AgentStatus.IDLE);
      await this.emitCollaboration('end', agentName, collabId);
    }
    await this.updateAgentStatus('cea', AgentStatus.IDLE);
    this.activeCollabs.clear();
    this.agentIdToName.clear();
    this.reportedAgents.clear();
    this.shutdownAgents.clear();
  }

  /** Emit a collaboration line event */
  private async emitCollaboration(
    phase: 'start' | 'end',
    agentName: string,
    collabId: string,
    color?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      id: generateEventId(),
      agentId: phase === 'start' ? 'cea' : agentName,
      runId: generateRunId(),
      seq: 1,
      stream: 'collaboration' as EventStream,
      timestamp: Date.now(),
      data: {
        phase,
        collaborationId: collabId,
        ...(phase === 'start' ? { type: 'parallel', topic: `Working: ${agentName}`, color } : {}),
        participants: ['cea', agentName],
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
