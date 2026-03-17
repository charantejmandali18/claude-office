import type { AgentEvent } from '@rigelhq/shared';

export type AgentEventCallback = (event: AgentEvent) => void | Promise<void>;

/** Summary of a Claude session discovered on this machine */
export interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  cwd?: string;
  gitBranch?: string;
  createdAt?: number;
}

export interface SessionHandle {
  sessionId: string;
  configId: string;
  /** Send a follow-up message to this session */
  send(message: string): Promise<void>;
  /** Close the session */
  close(): Promise<void>;
}

export interface SessionOptions {
  /** System prompt for the team lead session */
  systemPrompt?: string;
  /** Working directory for this session */
  cwd?: string;
}

export interface GatewayAdapter {
  /** Create a persistent session — stream stays alive for teammate events */
  createSession(
    configId: string,
    initialPrompt: string,
    onEvent: AgentEventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle>;

  /** List all Claude sessions on this machine */
  listSessions(): Promise<SessionInfo[]>;

  /** Stop a session */
  stop(handle: SessionHandle): Promise<void>;
  stopAll(): Promise<void>;
}
