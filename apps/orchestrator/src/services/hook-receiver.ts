import http from 'http';
import type { PrismaClient } from '@prisma/client';
import type { EventStream } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import { generateEventId, generateRunId } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';

/** Color palette for communication lines */
const LINE_COLORS = ['#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4', '#ec4899', '#22c55e'];
let colorIndex = 0;

/** Track active collaborations for line lifecycle */
const activeCollabs = new Map<string, string>(); // agentName → collabId

/** Map internal agent IDs (a080e64ae...) to agent names (github-repos-owner) */
const agentIdToName = new Map<string, string>();

/** Track agents that have stopped — ignore any late events for them */
const stoppedAgents = new Set<string>();

export class HookReceiver {
  private db: PrismaClient | null = null;

  constructor(private eventBus: EventBus) {}

  setDb(db: PrismaClient): void {
    this.db = db;
  }

  /** Returns an HTTP request handler for hook events */
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

    console.log(`[Hook] ${eventName} | session=${sessionId?.slice(0, 8)} agent=${agentId} tool=${toolName}`);

    switch (eventName) {
      case 'SessionStart': {
        const agentType = payload.agent_type as string ?? 'main';
        console.log(`[Hook] Session started: ${sessionId?.slice(0, 8)} type=${agentType}`);
        break;
      }

      case 'SessionEnd': {
        const reason = payload.reason as string ?? '';
        console.log(`[Hook] Session ended: ${sessionId?.slice(0, 8)} reason=${reason}`);
        // Mark all active agents as IDLE and close their lines
        for (const [agentName, collabId] of activeCollabs) {
          await this.updateAgentStatus(agentName, 'IDLE');
          await this.eventBus.publish({
            id: generateEventId(),
            agentId: agentName,
            runId: generateRunId(),
            seq: 1,
            stream: 'collaboration' as EventStream,
            timestamp: Date.now(),
            data: { phase: 'end', collaborationId: collabId, participants: ['cea', agentName] },
          });
        }
        activeCollabs.clear();
        agentIdToName.clear();
        stoppedAgents.clear();
        break;
      }

      case 'SubagentStart': {
        // A teammate/subagent process started — this fires for EVERY agent including teammates
        const agentType = payload.agent_type as string ?? '';
        console.log(`[Hook] 🚀 Subagent START: id=${agentId} type=${agentType} session=${sessionId?.slice(0, 8)}`);

        // Map internal ID → agent name (agent_type has the name like "github-repos-owner")
        if (agentId && agentType) {
          agentIdToName.set(agentId, agentType);
          // Clear stopped state in case of re-spawn
          stoppedAgents.delete(agentId);
          stoppedAgents.delete(agentType);
        }

        // Resolve the display name
        const agentName = agentType || agentId;

        // If this agent is already active (re-spawn), close the old one first
        if (agentName && activeCollabs.has(agentName)) {
          const oldCollabId = activeCollabs.get(agentName)!;
          activeCollabs.delete(agentName);
          await this.eventBus.publish({
            id: generateEventId(),
            agentId: agentName,
            runId: generateRunId(),
            seq: 1,
            stream: 'collaboration' as EventStream,
            timestamp: Date.now(),
            data: { phase: 'end', collaborationId: oldCollabId, participants: ['cea', agentName] },
          });
        }

        // CEA is actively coordinating while teammates work
        if (activeCollabs.size === 0) {
          // First teammate — CEA transitions from IDLE to THINKING
          await this.updateAgentStatus('cea', 'THINKING');
        }

        // If this is a known specialist, activate them in the UI
        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          await this.updateAgentStatus(agentName, 'THINKING');

          // Create communication line from CEA to this agent
          const color = LINE_COLORS[colorIndex % LINE_COLORS.length];
          colorIndex++;
          const collabId = `hook-${agentName}-${Date.now()}`;
          activeCollabs.set(agentName, collabId);

          await this.eventBus.publish({
            id: generateEventId(),
            agentId: 'cea',
            runId: generateRunId(),
            seq: 1,
            stream: 'collaboration' as EventStream,
            timestamp: Date.now(),
            data: {
              phase: 'start',
              collaborationId: collabId,
              type: 'parallel',
              participants: ['cea', agentName],
              topic: `Working: ${agentName}`,
              color,
            },
          });
        }
        break;
      }

      case 'SubagentStop': {
        // A teammate/subagent process stopped — resolve internal ID to name
        const agentName = agentIdToName.get(agentId) ?? agentId;
        console.log(`[Hook] 🏁 Subagent STOP: id=${agentId} name=${agentName} session=${sessionId?.slice(0, 8)}`);

        // Mark as stopped so late PostToolUse events are ignored
        stoppedAgents.add(agentId);
        if (agentName) stoppedAgents.add(agentName);

        if (agentName && AGENT_ROLE_MAP.has(agentName)) {
          // Debounce ALL state changes by 3s to handle Agent Teams shutdown protocol.
          // If the agent re-spawns within 3s, stoppedAgents guard prevents IDLE.
          setTimeout(async () => {
            if (!stoppedAgents.has(agentName)) return; // re-spawned, skip

            // Set agent IDLE
            await this.updateAgentStatus(agentName, 'IDLE');

            // End communication line
            const collabId = activeCollabs.get(agentName);
            if (collabId) {
              activeCollabs.delete(agentName);
              await this.eventBus.publish({
                id: generateEventId(),
                agentId: agentName,
                runId: generateRunId(),
                seq: 1,
                stream: 'collaboration' as EventStream,
                timestamp: Date.now(),
                data: {
                  phase: 'end',
                  collaborationId: collabId,
                  participants: ['cea', agentName],
                },
              });
            }

            // If ALL agents are now idle, set CEA to IDLE too
            if (activeCollabs.size === 0) {
              console.log(`[Hook] All teammates done — setting CEA to IDLE`);
              await this.updateAgentStatus('cea', 'IDLE');
            }
          }, 3000);
        }
        // Clean up ID mapping
        agentIdToName.delete(agentId);
        break;
      }

      case 'PreToolUse': {
        // Agent is about to use a tool — resolve name and show as TOOL_CALLING
        const resolvedName = agentIdToName.get(agentId) ?? agentId;
        // If no agentId, this is the team lead using a tool
        if (!agentId && toolName) {
          await this.updateAgentStatus('cea', 'TOOL_CALLING');
          break;
        }
        if (stoppedAgents.has(agentId) || stoppedAgents.has(resolvedName)) break; // ignore late events
        if (resolvedName && AGENT_ROLE_MAP.has(resolvedName)) {
          await this.updateAgentStatus(resolvedName, 'TOOL_CALLING');
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
        // Agent finished using a tool — resolve name
        const resolvedName = agentIdToName.get(agentId) ?? agentId;
        // If no agentId, this is the team lead
        if (!agentId && toolName) {
          // After team lead uses a tool, set to THINKING (will be set to SPEAKING by assistant messages)
          await this.updateAgentStatus('cea', 'THINKING');
          break;
        }
        if (stoppedAgents.has(agentId) || stoppedAgents.has(resolvedName)) break; // ignore late events
        if (resolvedName && AGENT_ROLE_MAP.has(resolvedName)) {
          await this.updateAgentStatus(resolvedName, 'THINKING');
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

        // If the tool is SendMessage, emit a communication event between agents
        if (toolName === 'SendMessage') {
          const toolInput = payload.tool_input as Record<string, unknown> | undefined;
          const to = (toolInput?.to as string) ?? (toolInput?.recipient as string);
          const fromName = agentIdToName.get(agentId) ?? agentId;
          if (to && fromName) {
            console.log(`[Hook] 💬 SendMessage: ${fromName} → ${to}`);
          }
        }
        break;
      }

      case 'Stop': {
        // Main agent turn ended — if no agent_id, this is the team lead stopping
        // Check if all teammates should be marked idle
        if (!agentId) {
          console.log(`[Hook] Team lead turn stopped: session=${sessionId?.slice(0, 8)} (${activeCollabs.size} active agents)`);
        } else {
          console.log(`[Hook] Agent stopped: ${agentIdToName.get(agentId) ?? agentId} session=${sessionId?.slice(0, 8)}`);
        }
        break;
      }

      case 'Notification': {
        const notificationType = payload.notification_type as string ?? '';
        console.log(`[Hook] Notification: type=${notificationType} session=${sessionId?.slice(0, 8)}`);
        break;
      }

      case 'UserPromptSubmit': {
        console.log(`[Hook] User prompt submitted: session=${sessionId?.slice(0, 8)}`);
        // CEA starts processing — set to THINKING
        await this.updateAgentStatus('cea', 'THINKING');
        break;
      }

      default:
        console.log(`[Hook] Unhandled: ${eventName}`);
    }
  }

  /** Update agent status in DB and broadcast via WebSocket */
  private async updateAgentStatus(agentId: string, status: string): Promise<void> {
    console.log(`[Hook] 📡 Status update: ${agentId} → ${status}`);
    if (this.db) {
      const roleMeta = AGENT_ROLE_MAP.get(agentId);
      if (roleMeta) {
        try {
          await this.db.agent.upsert({
            where: { configId: agentId },
            update: { status: status as any },
            create: {
              configId: agentId,
              name: roleMeta.name,
              role: roleMeta.role,
              icon: roleMeta.icon,
              status: status as any,
            },
          });
        } catch (err) {
          console.error(`[Hook] DB error for ${agentId}:`, err);
        }
      }
    }
    // Publish as a lifecycle event on the global channel so WebSocket picks it up
    const phase = status === 'IDLE' ? 'end' : status === 'THINKING' ? 'thinking' : 'start';
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
