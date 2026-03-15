import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback, SpawnOptions } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private handles = new Map<string, { abort: AbortController; configId: string }>();

  async spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
    options?: SpawnOptions,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: agentId ?? configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    this.handles.set(configId, { abort: abortController, configId });

    // Spawn Claude Agent SDK query in background
    const iter = query({
      prompt: taskPrompt,
      options: {
        abortController,
        systemPrompt,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        ...(options?.agents ? { agents: options.agents } : {}),
      },
    });

    // Process events in background
    (async () => {
      emit('lifecycle', { phase: 'start' });
      try {
        for await (const message of iter) {
          if (message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            emit('lifecycle', { phase: 'thinking' });
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                emit('assistant', { text: block.text });
              } else if (block.type === 'tool_use') {
                emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
                emit('tool', { tool: block.name, phase: 'end' });
              }
            }
          } else if (message.type === 'result') {
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype !== 'success') {
              emit('error', { error: `Agent run ended: ${resultMsg.subtype}` });
            }
            emit('lifecycle', { phase: 'end' });

          // Subagent task events — surface activity of delegated agents
          } else if (message.type === 'system') {
            const sysMsg = message as { type: 'system'; subtype: string; [key: string]: unknown };

            if (sysMsg.subtype === 'task_started') {
              const taskDesc = (sysMsg.description as string) ?? '';
              // Try to extract agent name from description (e.g. "backend-engineer: ...")
              const agentMatch = taskDesc.match(/^\[?([a-z-]+)\]?/i);
              const subAgentId = agentMatch?.[1] ?? 'subagent';
              emit('lifecycle', { phase: 'start' }, subAgentId);
              emit('assistant', { text: `Task started: ${taskDesc}` }, subAgentId);
            } else if (sysMsg.subtype === 'task_progress') {
              const subAgentId = extractAgentId(sysMsg.description as string);
              const lastTool = sysMsg.last_tool_name as string | undefined;
              if (lastTool) {
                emit('tool', { tool: lastTool, phase: 'start' }, subAgentId);
                emit('tool', { tool: lastTool, phase: 'end' }, subAgentId);
              }
              emit('lifecycle', { phase: 'thinking' }, subAgentId);
            } else if (sysMsg.subtype === 'task_notification') {
              const status = sysMsg.status as string;
              const summary = (sysMsg.summary as string) ?? '';
              const subAgentId = extractAgentId(summary);
              if (summary) {
                emit('assistant', { text: summary }, subAgentId);
              }
              if (status === 'failed') {
                emit('error', { error: `Subagent task failed` }, subAgentId);
              }
              emit('lifecycle', { phase: 'end' }, subAgentId);
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit('error', { error: errorMsg });
        emit('lifecycle', { phase: 'end' });
      } finally {
        this.handles.delete(configId);
      }
    })();

    const handle: AgentHandle = {
      id: `claude-${configId}-${Date.now()}`,
      configId,
      pid: null,
      stop: async () => {
        abortController.abort();
        this.handles.delete(configId);
      },
    };

    return handle;
  }

  async stop(handle: AgentHandle): Promise<void> {
    const entry = this.handles.get(handle.configId);
    if (entry) {
      entry.abort.abort();
      this.handles.delete(handle.configId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.handles) {
      entry.abort.abort();
    }
    this.handles.clear();
  }
}

/** Try to extract an agent config ID from a task description string */
function extractAgentId(desc: string | undefined): string {
  if (!desc) return 'subagent';
  const match = desc.match(/^\[?([a-z][\w-]*)\]?/i);
  return match?.[1] ?? 'subagent';
}
