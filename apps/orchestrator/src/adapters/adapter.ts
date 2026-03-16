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
  abort: AbortController;
  stop(): Promise<void>;
}

export interface SessionOptions {
  /** Enable ~30s AI-generated progress summaries for subagent tasks */
  agentProgressSummaries?: boolean;
  /** Working directory for this session */
  cwd?: string;
}

export interface GatewayAdapter {
  /** Create a new session with agent definitions */
  createSession(
    configId: string,
    prompt: string,
    agents: Record<string, import('@anthropic-ai/claude-agent-sdk').AgentDefinition>,
    onEvent: AgentEventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle>;

  /** Send a follow-up message to an existing session (resume) */
  resumeSession(
    handle: SessionHandle,
    message: string,
    onEvent: AgentEventCallback,
  ): Promise<void>;

  /** List all Claude sessions on this machine */
  listSessions(): Promise<SessionInfo[]>;

  /** Stop a session */
  stop(handle: SessionHandle): Promise<void>;
  stopAll(): Promise<void>;
}
