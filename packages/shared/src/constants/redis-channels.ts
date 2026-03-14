export const REDIS_CHANNELS = {
  /** Global event stream (all agents) */
  EVENTS: 'rigelhq:events',
  /** Per-agent event stream: rigelhq:agent:{configId}:events */
  agentEvents: (configId: string) => `rigelhq:agent:${configId}:events`,
  /** Per-agent status: rigelhq:agent:{configId}:status */
  agentStatus: (configId: string) => `rigelhq:agent:${configId}:status`,
  /** Task status changes */
  TASK_UPDATES: 'rigelhq:tasks:updates',
  /** User-agent chat messages */
  CHAT_MESSAGES: 'rigelhq:chat:messages',
} as const;

/** Redis Stream keys (persistent) */
export const REDIS_STREAMS = {
  /** Main event stream for history/replay */
  EVENTS: 'rigelhq:events:stream',
  /** Per-agent event stream */
  agentEvents: (configId: string) => `rigelhq:agent:${configId}:stream`,
} as const;
