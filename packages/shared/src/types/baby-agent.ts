import type { AgentStatus } from './agent.js';

export type BabyAgentType = 'Explore' | 'Plan' | 'general-purpose';

export interface BabyAgent {
  taskId: string;
  parentAgentId: string;
  type: BabyAgentType;
  icon: string;
  status: AgentStatus;
  spawnedAt: number;
}

export const BABY_AGENT_ICONS: Record<BabyAgentType, string> = {
  'Explore': '🔍',
  'Plan': '📋',
  'general-purpose': '⚙️',
};
