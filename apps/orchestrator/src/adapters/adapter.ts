import type { AgentEvent } from '@rigelhq/shared';

export interface AgentHandle {
  id: string;
  configId: string;
  pid: number | null;
  stop(): Promise<void>;
}

export type AgentEventCallback = (event: AgentEvent) => void;

export interface GatewayAdapter {
  spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
  ): Promise<AgentHandle>;

  stop(handle: AgentHandle): Promise<void>;
  stopAll(): Promise<void>;
}
