export const EVENT_STREAMS = ['lifecycle', 'tool', 'assistant', 'error'] as const;

export const LIFECYCLE_PHASES = ['start', 'thinking', 'end'] as const;

export const AGENT_STATUSES = [
  'OFFLINE',
  'IDLE',
  'THINKING',
  'TOOL_CALLING',
  'SPEAKING',
  'COLLABORATING',
  'ERROR',
] as const;

export const TASK_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'IN_REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const TASK_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
