import http from 'http';
import type { EventBus } from './event-bus.js';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import { generateEventId, generateRunId } from '@rigelhq/shared';

export class HookReceiver {
  constructor(private eventBus: EventBus) {}

  /** Returns an HTTP request handler for hook events */
  handler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return (req, res) => {
      // Only handle POST /hooks/event
      if (req.method === 'POST' && req.url === '/hooks/event') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            this.processHook(payload).catch((err) => {
              console.error('[HookReceiver] Error processing hook:', err);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
          } catch (err) {
            console.error('[HookReceiver] Invalid JSON:', err);
            res.writeHead(400);
            res.end('{"error":"invalid json"}');
          }
        });
      } else {
        // Pass through for other routes (WebSocket upgrade, etc.)
        res.writeHead(404);
        res.end();
      }
    };
  }

  private async processHook(payload: Record<string, unknown>): Promise<void> {
    const eventName = payload.hook_event_name as string;
    console.log(`[HookReceiver] Received hook: ${eventName}`);

    switch (eventName) {
      case 'SubagentStart': {
        // A specialist or sub-agent started
        const agentId = (payload.agent_id as string) ?? 'unknown';
        console.log(`[HookReceiver] Subagent started: ${agentId}`);
        await this.eventBus.publish({
          id: generateEventId(),
          agentId,
          runId: generateRunId(),
          seq: 1,
          stream: 'baby-agent',
          timestamp: Date.now(),
          data: { phase: 'start', ...payload },
        });
        break;
      }
      case 'SubagentStop': {
        const agentId = (payload.agent_id as string) ?? 'unknown';
        console.log(`[HookReceiver] Subagent stopped: ${agentId}`);
        await this.eventBus.publish({
          id: generateEventId(),
          agentId,
          runId: generateRunId(),
          seq: 1,
          stream: 'baby-agent',
          timestamp: Date.now(),
          data: { phase: 'end', ...payload },
        });
        break;
      }
      case 'TeammateIdle': {
        const teammateName = payload.teammate_name as string;
        const teamName = payload.team_name as string;
        console.log(`[HookReceiver] Teammate idle: ${teammateName} in ${teamName}`);
        if (teammateName && AGENT_ROLE_MAP.has(teammateName)) {
          await this.eventBus.publishStatus(teammateName, 'IDLE');
        }
        break;
      }
      case 'TaskCompleted': {
        const taskId = payload.task_id as string;
        const teammateName = payload.teammate_name as string;
        console.log(`[HookReceiver] Task completed: ${taskId} by ${teammateName}`);
        if (teammateName && AGENT_ROLE_MAP.has(teammateName)) {
          await this.eventBus.publishStatus(teammateName, 'IDLE');
        }
        break;
      }
      case 'PostToolUse': {
        const toolName = payload.tool_name as string;
        console.log(`[HookReceiver] Tool used: ${toolName}`);
        // Emit tool event — agentId comes from hook context
        break;
      }
      default:
        console.log(`[HookReceiver] Unhandled hook event: ${eventName}`);
    }
  }
}
