import {
  unstable_v2_createSession,
  listSessions as sdkListSessions,
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKSession, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle, AgentEventCallback, SessionOptions, SessionInfo } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private sessions = new Map<string, { session: SDKSession; configId: string }>();
  /** Map tool_use_id → agent name from Agent tool calls */
  private toolUseToAgent = new Map<string, string>();

  async createSession(
    configId: string,
    initialPrompt: string,
    onEvent: AgentEventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle> {
    const runId = generateRunId();
    let seq = 0;

    const emit = async (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      await onEvent({
        id: generateEventId(),
        agentId: agentId ?? configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    // Create a persistent V2 session — stays alive for teammate events
    const session = unstable_v2_createSession({
      model: 'claude-opus-4-6',
      permissionMode: 'bypassPermissions',
      env: {
        ...process.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
    });

    this.sessions.set(configId, { session, configId });

    // Start the background stream processor — runs for the entire session lifetime
    const streamProcessor = (async () => {
      await emit('lifecycle', { phase: 'start' });
      try {
        for await (const message of session.stream()) {
          await this.processMessage(message, configId, emit);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (!errorMsg.includes('abort') && !errorMsg.includes('closed')) {
          await emit('error', { error: errorMsg });
        }
      }
      await emit('lifecycle', { phase: 'end' });
    })();

    // Send the initial prompt (with system prompt prepended)
    const fullPrompt = options?.systemPrompt
      ? `[System Instructions]\n${options.systemPrompt}\n\n[User Message]\n${initialPrompt}`
      : initialPrompt;

    await session.send(fullPrompt);

    // Wait briefly for session ID to be populated
    let sessionId = '';
    for (let i = 0; i < 50; i++) {
      try {
        sessionId = session.sessionId;
        if (sessionId) break;
      } catch { /* not initialized yet */ }
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[Claude] V2 session created for ${configId}: ${sessionId}`);

    const handle: SessionHandle = {
      sessionId,
      configId,
      send: async (message: string) => {
        await session.send(message);
      },
      close: async () => {
        session.close();
        this.sessions.delete(configId);
      },
    };

    return handle;
  }

  /** Process a single SDK message and emit appropriate events */
  private async processMessage(
    message: SDKMessage,
    configId: string,
    emit: (stream: EventStream, data: AgentEvent['data'], agentId?: string) => Promise<void>,
  ): Promise<void> {
    if (message.type === 'system') {
      const raw = message as unknown as Record<string, unknown>;
      const subtype = raw.subtype as string;

      if (subtype === 'init') {
        console.log(`[Claude] Session init for ${configId}: ${raw.session_id}`);
      } else if (subtype === 'task_started') {
        const taskDesc = (raw.description as string) ?? '';
        const toolUseId = raw.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(raw, toolUseId);
        const taskType = raw.task_type as string;
        console.log(`[Claude] ${taskType === 'in_process_teammate' ? 'Teammate' : 'Agent'} started: ${agentId} — "${taskDesc.slice(0, 60)}"`);
        await emit('lifecycle', { phase: 'start', taskId: raw.task_id, taskType }, agentId);
        await emit('assistant', { text: `Working on: ${taskDesc}` }, agentId);
      } else if (subtype === 'task_progress') {
        const toolUseId = raw.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(raw, toolUseId);
        const lastTool = raw.last_tool_name as string | undefined;
        if (lastTool) {
          await emit('tool', { tool: lastTool, phase: 'start' }, agentId);
          await emit('tool', { tool: lastTool, phase: 'end' }, agentId);
        }
        const summary = raw.summary as string | undefined;
        if (summary) {
          await emit('assistant', { text: summary }, agentId);
        }
        await emit('lifecycle', { phase: 'thinking' }, agentId);
      } else if (subtype === 'task_notification') {
        const status = raw.status as string;
        const summary = (raw.summary as string) ?? '';
        const toolUseId = raw.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(raw, toolUseId);
        if (summary) {
          await emit('assistant', { text: summary }, agentId);
        }
        if (status === 'failed') {
          await emit('error', { error: 'Task failed' }, agentId);
        }
        await emit('lifecycle', { phase: 'end' }, agentId);
        if (toolUseId) this.toolUseToAgent.delete(toolUseId);
        console.log(`[Claude] Agent completed: ${agentId} (${status})`);
      }
    } else if (message.type === 'assistant') {
      const raw = message as unknown as Record<string, unknown>;
      const msg = raw.message as Record<string, unknown>;
      const content = msg?.content as Array<Record<string, unknown>>;
      if (!content) return;

      await emit('lifecycle', { phase: 'thinking' });
      for (const block of content) {
        if (block.type === 'text') {
          await emit('assistant', { text: block.text as string });
        } else if (block.type === 'tool_use') {
          const toolName = block.name as string;
          const toolId = block.id as string;
          const input = block.input as Record<string, unknown>;

          // Track Agent/TeamCreate/SendMessage for visualization
          if (toolName === 'Agent') {
            const agentName = (input.name as string) ?? (input.subagent_type as string);
            if (agentName) {
              this.toolUseToAgent.set(toolId, agentName);
              const teamName = input.team_name as string | undefined;
              console.log(`[Claude] Agent call ${toolId} → ${agentName}${teamName ? ` (team: ${teamName})` : ''}`);
            }
          } else if (toolName === 'TeamCreate') {
            console.log(`[Claude] TeamCreate: ${input.team_name}`);
          } else if (toolName === 'SendMessage') {
            console.log(`[Claude] SendMessage to: ${input.to ?? input.recipient}`);
          }

          await emit('tool', { tool: toolName, phase: 'start', toolArgs: input });
          await emit('tool', { tool: toolName, phase: 'end' });
        }
      }
    } else if (message.type === 'result') {
      const raw = message as unknown as Record<string, unknown>;
      console.log(`[Claude] Result: ${raw.subtype}`);
      // Don't emit lifecycle:end here — the V2 stream stays alive
      // Lifecycle end is emitted when the stream itself closes
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const sessions = await sdkListSessions();
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        summary: s.summary,
        lastModified: s.lastModified,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        createdAt: s.createdAt,
      }));
    } catch (err) {
      console.error('[Claude] Failed to list sessions:', err);
      return [];
    }
  }

  async stop(handle: SessionHandle): Promise<void> {
    await handle.close();
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.sessions) {
      entry.session.close();
    }
    this.sessions.clear();
  }

  /** Resolve agent ID from task events */
  private resolveAgentId(raw: Record<string, unknown>, toolUseId?: string): string {
    // Strategy 1: Direct subagent_type
    if (typeof raw.subagent_type === 'string') return raw.subagent_type;
    // Strategy 2: Look up from tool_use_id mapping
    if (toolUseId && this.toolUseToAgent.has(toolUseId)) {
      return this.toolUseToAgent.get(toolUseId)!;
    }
    // Strategy 3: For in_process_teammate, name is before the colon in description
    const desc = (raw.description as string) ?? '';
    if (raw.task_type === 'in_process_teammate') {
      const colonIdx = desc.indexOf(':');
      if (colonIdx > 0) {
        const name = desc.slice(0, colonIdx).trim();
        if (name) return name;
      }
    }
    // Strategy 4: Parse from description
    return extractAgentId(desc || (raw.summary as string));
  }
}

/** Extract session_id from an SDK init message */
function extractSessionId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.session_id === 'string') return raw.session_id;
  const data = raw.data as Record<string, unknown> | undefined;
  if (typeof data?.session_id === 'string') return data.session_id;
  return undefined;
}

/** Extract agent ID from description text */
function extractAgentId(desc: string | undefined, subagentType?: string): string {
  if (subagentType) return subagentType;
  if (!desc) return 'subagent';
  const match = desc.match(/^\[?([a-z][\w-]*)\]?/i);
  return match?.[1] ?? 'subagent';
}
