import { query, listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle, AgentEventCallback, SessionOptions, SessionInfo } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private handles = new Map<string, { abort: AbortController; configId: string; runId: string }>();
  /** Track active query completions so we can wait for them to settle after abort */
  private activeQueries = new Map<string, { abort: AbortController; done: Promise<void>; resolve: () => void; runId: string }>();
  /** Configs currently being interrupted — suppresses error events */
  private interrupting = new Set<string>();
  /** Map tool_use_id → subagent_type from Agent tool calls, so task events can be attributed */
  private toolUseToAgent = new Map<string, string>();

  async createSession(
    configId: string,
    prompt: string,
    agents: Record<string, AgentDefinition>,
    onEvent: AgentEventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;
    let sessionId: string | null = null;

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

    this.handles.set(configId, { abort: abortController, configId, runId });

    const iter = query({
      prompt,
      options: {
        abortController,
        agents,
        agentProgressSummaries: options?.agentProgressSummaries ?? true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Load user settings so hooks (SubagentStart, TeammateIdle, etc.) fire
        settingSources: ['user'],
        ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options?.cwd ? { cwd: options.cwd } : {}),
      },
    });

    // Build handle — sessionId populated once init message arrives
    const handle: SessionHandle = {
      sessionId: '', // will be set from init message
      configId,
      abort: abortController,
      stop: async () => {
        abortController.abort();
        this.handles.delete(configId);
      },
    };

    // Process events in background, tracked for interrupt support
    let queryResolve: () => void;
    const queryDone = new Promise<void>((r) => { queryResolve = r; });
    this.activeQueries.set(configId, { abort: abortController, done: queryDone, resolve: queryResolve!, runId });

    (async () => {
      await emit('lifecycle', { phase: 'start' });
      try {
        for await (const message of iter) {
          if (message.type === 'system') {
            const raw = message as unknown as Record<string, unknown>;
            const subtype = raw.subtype as string;

            if (subtype === 'init') {
              const sid = extractSessionId(raw);
              if (sid) {
                sessionId = sid;
                handle.sessionId = sessionId;
                console.log(`[Claude] Session started for ${configId}: ${sessionId}`);
              } else {
                console.warn(`[Claude] Init message for ${configId} had no session_id! Keys: ${Object.keys(raw).join(', ')}`);
              }
            } else if (subtype === 'task_started') {
              const taskDesc = (raw.description as string) ?? '';
              const toolUseId = raw.tool_use_id as string | undefined;
              const subAgentId = this.resolveAgentId(raw, toolUseId);
              console.log(`[Claude] Subagent started for ${configId}: ${subAgentId} (tool_use_id: ${toolUseId}) — "${taskDesc.slice(0, 60)}"`);
              await emit('lifecycle', { phase: 'start', taskId: raw.task_id }, subAgentId);
              await emit('assistant', { text: `Working on: ${taskDesc}` }, subAgentId);
            } else if (subtype === 'task_progress') {
              const toolUseId = raw.tool_use_id as string | undefined;
              const subAgentId = this.resolveAgentId(raw, toolUseId);
              const lastTool = raw.last_tool_name as string | undefined;
              if (lastTool) {
                await emit('tool', { tool: lastTool, phase: 'start' }, subAgentId);
                await emit('tool', { tool: lastTool, phase: 'end' }, subAgentId);
              }
              const summary = raw.summary as string | undefined;
              if (summary) {
                await emit('assistant', { text: summary }, subAgentId);
              }
              await emit('lifecycle', { phase: 'thinking' }, subAgentId);
            } else if (subtype === 'task_notification') {
              const status = raw.status as string;
              const summary = (raw.summary as string) ?? '';
              const toolUseId = raw.tool_use_id as string | undefined;
              const subAgentId = this.resolveAgentId(raw, toolUseId);
              if (summary) {
                await emit('assistant', { text: summary }, subAgentId);
              }
              if (status === 'failed') {
                await emit('error', { error: 'Subagent task failed' }, subAgentId);
              }
              await emit('lifecycle', { phase: 'end' }, subAgentId);
              // Clean up tool_use mapping
              if (toolUseId) this.toolUseToAgent.delete(toolUseId);
              console.log(`[Claude] Subagent completed for ${configId}: ${subAgentId} (${status})`);
            }
          } else if (message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            await emit('lifecycle', { phase: 'thinking' });
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                await emit('assistant', { text: block.text });
              } else if (block.type === 'tool_use') {
                // Track Agent tool calls so we can attribute task events to specialists
                if (block.name === 'Agent') {
                  const input = block.input as Record<string, unknown>;
                  // Teammate spawn: has name + team_name
                  const agentName = (input.name as string) ?? (input.subagent_type as string);
                  if (agentName) {
                    this.toolUseToAgent.set(block.id, agentName);
                    const teamName = input.team_name as string | undefined;
                    const isTeammate = !!teamName;
                    console.log(`[Claude] Agent tool call ${block.id} → ${agentName}${isTeammate ? ` (team: ${teamName})` : ''}`);
                  }
                } else if (block.name === 'TeamCreate') {
                  const input = block.input as Record<string, unknown>;
                  console.log(`[Claude] TeamCreate: ${input.team_name}`);
                } else if (block.name === 'SendMessage') {
                  const input = block.input as Record<string, unknown>;
                  console.log(`[Claude] SendMessage to: ${input.to ?? input.recipient}`);
                }
                await emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
                await emit('tool', { tool: block.name, phase: 'end' });
              }
            }
          } else if (message.type === 'result') {
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype !== 'success') {
              if (!this.interrupting.has(configId)) {
                await emit('error', { error: `Agent run ended: ${resultMsg.subtype}` });
              }
            }
            await emit('lifecycle', { phase: 'end' });
          }
        }
      } catch (err) {
        if (!this.interrupting.has(configId)) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await emit('error', { error: errorMsg });
        }
        await emit('lifecycle', { phase: 'end' });
      } finally {
        if (this.handles.get(configId)?.runId === runId) {
          this.handles.delete(configId);
        }
        if (this.activeQueries.get(configId)?.runId === runId) {
          this.activeQueries.delete(configId);
        }
        queryResolve!();
      }
    })();

    return handle;
  }

  /**
   * Interrupt any in-progress query for this config.
   * Aborts the current query and waits for its iterator to settle.
   * The session ID is preserved — only the active run is cancelled.
   */
  private async interrupt(configId: string): Promise<void> {
    const active = this.activeQueries.get(configId);
    if (!active) return;

    console.log(`[Claude] Interrupting active query for ${configId} (steering)`);
    this.interrupting.add(configId);
    active.abort.abort();

    try {
      await Promise.race([
        active.done,
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);
    } finally {
      this.interrupting.delete(configId);
    }
  }

  async resumeSession(
    handle: SessionHandle,
    message: string,
    onEvent: AgentEventCallback,
  ): Promise<void> {
    if (!handle.sessionId) {
      throw new Error(`No session to resume for ${handle.configId}`);
    }

    // Interrupt any in-progress query first (steer, don't abort)
    await this.interrupt(handle.configId);

    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = async (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      await onEvent({
        id: generateEventId(),
        agentId: agentId ?? handle.configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    this.handles.set(handle.configId, { abort: abortController, configId: handle.configId, runId });

    // Update handle's abort controller so external stop() works
    handle.abort = abortController;

    let queryResolve: () => void;
    const queryDone = new Promise<void>((r) => { queryResolve = r; });
    this.activeQueries.set(handle.configId, { abort: abortController, done: queryDone, resolve: queryResolve!, runId });

    const iter = query({
      prompt: message,
      options: {
        abortController,
        resume: handle.sessionId,
        agentProgressSummaries: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user'],
      },
    });

    await emit('lifecycle', { phase: 'start' });
    try {
      for await (const msg of iter) {
        if (msg.type === 'system') {
          const raw = msg as unknown as Record<string, unknown>;
          const subtype = raw.subtype as string;

          if (subtype === 'init') {
            const sid = extractSessionId(raw);
            if (sid) {
              handle.sessionId = sid;
              console.log(`[Claude] Session resumed for ${handle.configId}: ${sid}`);
            }
          } else if (subtype === 'task_started') {
            const taskDesc = (raw.description as string) ?? '';
            const toolUseId = raw.tool_use_id as string | undefined;
            const subAgentId = this.resolveAgentId(raw, toolUseId);
            console.log(`[Claude] Subagent started for ${handle.configId}: ${subAgentId} (tool_use_id: ${toolUseId}) — "${taskDesc.slice(0, 60)}"`);
            await emit('lifecycle', { phase: 'start', taskId: raw.task_id }, subAgentId);
            await emit('assistant', { text: `Working on: ${taskDesc}` }, subAgentId);
          } else if (subtype === 'task_progress') {
            const toolUseId = raw.tool_use_id as string | undefined;
            const subAgentId = this.resolveAgentId(raw, toolUseId);
            const lastTool = raw.last_tool_name as string | undefined;
            if (lastTool) {
              await emit('tool', { tool: lastTool, phase: 'start' }, subAgentId);
              await emit('tool', { tool: lastTool, phase: 'end' }, subAgentId);
            }
            const summary = raw.summary as string | undefined;
            if (summary) await emit('assistant', { text: summary }, subAgentId);
            await emit('lifecycle', { phase: 'thinking' }, subAgentId);
          } else if (subtype === 'task_notification') {
            const status = raw.status as string;
            const summary = (raw.summary as string) ?? '';
            const toolUseId = raw.tool_use_id as string | undefined;
            const subAgentId = this.resolveAgentId(raw, toolUseId);
            if (summary) await emit('assistant', { text: summary }, subAgentId);
            if (status === 'failed') await emit('error', { error: 'Subagent task failed' }, subAgentId);
            await emit('lifecycle', { phase: 'end' }, subAgentId);
            if (toolUseId) this.toolUseToAgent.delete(toolUseId);
            console.log(`[Claude] Subagent completed for ${handle.configId}: ${subAgentId} (${status})`);
          }
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as SDKAssistantMessage;
          await emit('lifecycle', { phase: 'thinking' });
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              await emit('assistant', { text: block.text });
            } else if (block.type === 'tool_use') {
              await emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
              await emit('tool', { tool: block.name, phase: 'end' });
            }
          }
        } else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;
          if (resultMsg.subtype !== 'success') {
            if (!this.interrupting.has(handle.configId)) {
              await emit('error', { error: `Agent run ended: ${resultMsg.subtype}` });
            }
          }
          await emit('lifecycle', { phase: 'end' });
        }
      }
    } catch (err) {
      if (!this.interrupting.has(handle.configId)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await emit('error', { error: errorMsg });
      }
      await emit('lifecycle', { phase: 'end' });
    } finally {
      if (this.handles.get(handle.configId)?.runId === runId) {
        this.handles.delete(handle.configId);
      }
      if (this.activeQueries.get(handle.configId)?.runId === runId) {
        this.activeQueries.delete(handle.configId);
      }
      queryResolve!();
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
    handle.abort.abort();
    this.handles.delete(handle.configId);
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.handles) {
      entry.abort.abort();
    }
    this.handles.clear();
  }

  /** Resolve agent ID from task events using multiple strategies */
  private resolveAgentId(raw: Record<string, unknown>, toolUseId?: string): string {
    // Strategy 1: Direct subagent_type on the event
    if (typeof raw.subagent_type === 'string') return raw.subagent_type;
    // Strategy 2: Look up from our tool_use_id → agent mapping
    if (toolUseId && this.toolUseToAgent.has(toolUseId)) {
      return this.toolUseToAgent.get(toolUseId)!;
    }
    // Strategy 3: For in_process_teammate, the description starts with "name: ..."
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

/** Extract session_id from an SDK init message.
 *  TS SDK puts it directly on the message; Python SDK nests it under `data`. Handle both. */
function extractSessionId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.session_id === 'string') return raw.session_id;
  const data = raw.data as Record<string, unknown> | undefined;
  if (typeof data?.session_id === 'string') return data.session_id;
  return undefined;
}

/** Extract agent ID from task description or subagent_type field */
function extractAgentId(desc: string | undefined, subagentType?: string): string {
  if (subagentType) return subagentType;
  if (!desc) return 'subagent';
  const match = desc.match(/^\[?([a-z][\w-]*)\]?/i);
  return match?.[1] ?? 'subagent';
}
