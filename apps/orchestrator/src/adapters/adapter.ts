import type { AgentEvent } from '@rigelhq/shared';

export interface AgentHandle {
  id: string;
  configId: string;
  pid: number | null;
  stop(): Promise<void>;
}

export type AgentEventCallback = (event: AgentEvent) => void;

/** Subagent definition passed to the SDK's agents option */
export interface SubagentDef {
  description: string;
  prompt: string;
  tools?: string[];
}

export interface SpawnOptions {
  /** Subagent definitions that this agent can delegate to via the Agent tool */
  agents?: Record<string, SubagentDef>;
}

export interface GatewayAdapter {
  spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
    options?: SpawnOptions,
  ): Promise<AgentHandle>;

  stop(handle: AgentHandle): Promise<void>;
  stopAll(): Promise<void>;
}
