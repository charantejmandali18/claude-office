import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private handles = new Map<string, { abort: AbortController; configId: string }>();

  async spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = (stream: EventStream, data: AgentEvent['data']) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: configId,
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
