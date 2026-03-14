export interface AgentRoleMeta {
  id: string;
  name: string;
  icon: string;
  role: string;
  zone: 'executive' | 'engineering' | 'ops' | 'quality';
  mvpActive: boolean;
}

export const AGENT_ROLES: AgentRoleMeta[] = [
  { id: 'cea', name: 'Chief Executive Agent', icon: '👔', role: 'Orchestrator', zone: 'executive', mvpActive: true },
  { id: 'github-repos-owner', name: 'GitHub Repos Owner', icon: '🔄', role: 'Repository Owner & Maintainer', zone: 'quality', mvpActive: false },
  { id: 'backend-engineer', name: 'Backend Engineer', icon: '⚙️', role: 'Senior Backend Engineer', zone: 'engineering', mvpActive: true },
  { id: 'frontend-engineer', name: 'Frontend Engineer', icon: '🎨', role: 'Senior Frontend Engineer', zone: 'engineering', mvpActive: true },
  { id: 'app-developer', name: 'App Developer', icon: '📱', role: 'Senior Mobile App Developer', zone: 'engineering', mvpActive: false },
  { id: 'product-manager', name: 'Product Manager', icon: '📋', role: 'Senior Product Manager', zone: 'executive', mvpActive: true },
  { id: 'ux-designer', name: 'UX Designer', icon: '🎯', role: 'Senior UX Designer', zone: 'quality', mvpActive: false },
  { id: 'qa-tester', name: 'QA Tester', icon: '🧪', role: 'Senior QA Engineer', zone: 'quality', mvpActive: false },
  { id: 'automation-qa-tester', name: 'Automation QA Tester', icon: '🤖', role: 'Senior QA Automation Engineer', zone: 'quality', mvpActive: false },
  { id: 'load-tester', name: 'Load Tester', icon: '📊', role: 'Performance Test Engineer', zone: 'ops', mvpActive: false },
  { id: 'sre-engineer', name: 'SRE Engineer', icon: '🔧', role: 'Site Reliability Engineer', zone: 'ops', mvpActive: false },
  { id: 'infra-engineer', name: 'Infra Engineer', icon: '☁️', role: 'Infrastructure Engineer', zone: 'engineering', mvpActive: false },
  { id: 'dba-engineer', name: 'DBA Engineer', icon: '🗄️', role: 'Database Administrator', zone: 'ops', mvpActive: false },
  { id: 'platform-engineer', name: 'Platform Engineer', icon: '🏗️', role: 'Platform Engineer', zone: 'engineering', mvpActive: false },
  { id: 'devops-engineer', name: 'DevOps Engineer', icon: '🚀', role: 'DevOps Engineer', zone: 'engineering', mvpActive: true },
  { id: 'noc-engineer', name: 'NOC Engineer', icon: '📡', role: 'NOC Engineer', zone: 'ops', mvpActive: false },
  { id: 'operations-engineer', name: 'Operations Engineer', icon: '⚡', role: 'Operations Engineer', zone: 'ops', mvpActive: false },
  { id: 'projects-manager', name: 'Projects Manager', icon: '📁', role: 'Technical Program Manager', zone: 'executive', mvpActive: false },
  { id: 'security-engineer', name: 'Security Engineer', icon: '🔒', role: 'Security Engineer', zone: 'ops', mvpActive: false },
  { id: 'code-review-engineer', name: 'Code Review Engineer', icon: '👁️', role: 'Code Review Specialist', zone: 'quality', mvpActive: false },
  { id: 'technical-architect', name: 'Technical Architect', icon: '🏛️', role: 'Solutions Architect', zone: 'executive', mvpActive: false },
];

export const AGENT_ROLE_MAP = new Map(AGENT_ROLES.map(r => [r.id, r]));
