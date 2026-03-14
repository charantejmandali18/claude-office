import type { AgentEvent, EventStream } from '../types/events';
import { generateEventId } from './id-generator';

export function createAgentEvent(
  agentId: string,
  runId: string,
  seq: number,
  stream: EventStream,
  data: AgentEvent['data'],
  sessionKey?: string,
): AgentEvent {
  return {
    id: generateEventId(),
    agentId,
    runId,
    seq,
    stream,
    timestamp: Date.now(),
    data,
    sessionKey,
  };
}

export function createLifecycleEvent(
  agentId: string,
  runId: string,
  seq: number,
  phase: 'start' | 'thinking' | 'end',
): AgentEvent {
  return createAgentEvent(agentId, runId, seq, 'lifecycle', { phase });
}

export function createToolEvent(
  agentId: string,
  runId: string,
  seq: number,
  tool: string,
  phase: 'start' | 'end',
  toolArgs?: Record<string, unknown>,
): AgentEvent {
  return createAgentEvent(agentId, runId, seq, 'tool', { tool, phase, toolArgs });
}

export function createAssistantEvent(
  agentId: string,
  runId: string,
  seq: number,
  text: string,
): AgentEvent {
  return createAgentEvent(agentId, runId, seq, 'assistant', { text });
}

export function createErrorEvent(
  agentId: string,
  runId: string,
  seq: number,
  error: string,
): AgentEvent {
  return createAgentEvent(agentId, runId, seq, 'error', { error });
}
