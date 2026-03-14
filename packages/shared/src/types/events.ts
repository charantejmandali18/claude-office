export type EventStream = 'lifecycle' | 'tool' | 'assistant' | 'error';

export interface AgentEvent {
  id: string;
  agentId: string;
  runId: string;
  seq: number;
  stream: EventStream;
  timestamp: number;
  data: {
    phase?: 'start' | 'thinking' | 'end';
    tool?: string;
    toolArgs?: Record<string, unknown>;
    text?: string;
    error?: string;
    [key: string]: unknown;
  };
  sessionKey?: string;
}

export interface ParsedAgentEvent {
  agentId: string;
  status: import('./agent').AgentStatus;
  tool: string | null;
  text: string | null;
  error: string | null;
  timestamp: number;
}
