export type AgentStatus =
  | 'OFFLINE'
  | 'IDLE'
  | 'THINKING'
  | 'TOOL_CALLING'
  | 'SPEAKING'
  | 'COLLABORATING'
  | 'ERROR';

export interface AgentConfig {
  id: string;
  name: string;
  icon: string;
  role: string;
  seniority: string;
  status: 'always_active' | 'standby';
  persona: {
    background: string;
    communication_style: string;
    principles: string[];
  };
  core_responsibilities: string[];
  capabilities: {
    languages?: string[];
    frameworks?: string[];
    domains: string[];
    tools: string[];
  };
  collaboration: {
    works_closely_with?: string[];
    reports_to: string;
    manages?: string[];
    triggers?: string[];
    decision_authority?: string;
  };
  quality_standards: string[];
  red_flags?: string[];
  review_checklist?: string[];
}

export interface Agent {
  id: string;
  configId: string;
  name: string;
  role: string;
  icon: string;
  status: AgentStatus;
  pid: number | null;
  startedAt: Date | null;
  metadata: Record<string, unknown> | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentWithPosition extends Agent {
  position: { x: number; y: number };
  zone: 'executive' | 'engineering' | 'ops' | 'quality' | 'meeting' | 'corridor' | 'lounge';
  currentTool: string | null;
  speechBubble: string | null;
  taskProgress: number | null;
}
