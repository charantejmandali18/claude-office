import type { AgentManager } from './agent-manager.js';
import type { TaskManager } from './task-manager.js';
import type { EventBus } from './event-bus.js';
import type { AgentHandle } from '../adapters/adapter.js';
import type { SubagentDef } from '../adapters/adapter.js';
import { AGENT_ROLES, AGENT_CONFIGS } from '@rigelhq/shared';
import { agentConfigLoader } from './agent-config-loader.js';

const CEA_CONFIG_ID = 'cea';

// Build a rich system prompt from the CEA config + full agent roster
const ceaConfig = AGENT_CONFIGS.find(c => c.id === 'cea');
const CEA_SYSTEM_PROMPT = `You are the Chief Executive Agent (CEA) of RigelHQ, an AI-powered command center.
${ceaConfig?.persona.background ?? 'You are a seasoned technology executive with deep expertise in multi-agent orchestration.'}

## Communication Style
${ceaConfig?.persona.communication_style ?? 'Direct, strategic, and decisive.'}

## Core Principles
${ceaConfig?.persona.principles.map(p => `- ${p}`).join('\n') ?? '- Lead with clarity and purpose'}

## Your Team
You orchestrate a team of specialist agents. When a user gives you a task:
1. Analyze the request and decide which specialist(s) to involve
2. Use the Agent tool to delegate to the right specialist by name
3. You can delegate to multiple agents in parallel for independent subtasks
4. Review agent outputs before reporting back to the user
5. Coordinate between agents when tasks require cross-team collaboration

Available specialist agents you can delegate to:
${AGENT_ROLES.filter(r => r.id !== 'cea').map(r => {
  const cfg = AGENT_CONFIGS.find(c => c.id === r.id);
  const triggers = cfg?.collaboration?.triggers?.join(', ') ?? r.role;
  return `- **${r.id}**: ${r.name} (${r.role}) — use for: ${triggers}`;
}).join('\n')}

## When to Delegate
- Backend work (APIs, databases, services) → backend-engineer
- Frontend work (UI, components, styling) → frontend-engineer
- DevOps (CI/CD, Docker, infra) → devops-engineer
- Architecture decisions → technical-architect
- Testing → qa-engineer or security-engineer
- Documentation → technical-writer
- For complex tasks, delegate to multiple agents simultaneously

## Quality Standards
${ceaConfig?.quality_standards.map(q => `- ${q}`).join('\n') ?? '- Ensure high quality outputs'}
`;

/** Build subagent definitions for all specialist agents */
function buildSubagentDefs(): Record<string, SubagentDef> {
  const defs: Record<string, SubagentDef> = {};

  for (const role of AGENT_ROLES) {
    if (role.id === 'cea') continue; // CEA is the orchestrator, not a subagent

    const cfg = AGENT_CONFIGS.find(c => c.id === role.id);
    if (!cfg) continue;

    defs[role.id] = {
      description: `${role.name} — ${role.role}. ${cfg.collaboration?.triggers?.join(', ') ?? ''}`,
      prompt: agentConfigLoader.generateSystemPrompt(role.id),
      tools: cfg.capabilities.tools.filter(t => t !== 'Agent'), // Subagents don't get Agent tool
    };
  }

  return defs;
}

const SUBAGENT_DEFS = buildSubagentDefs();

export class CEAManager {
  private handle: AgentHandle | null = null;
  private messageQueue: string[] = [];
  private healthy = false;

  constructor(
    private agentManager: AgentManager,
    private _taskManager: TaskManager,
    private _eventBus: EventBus,
  ) {}

  get isHealthy(): boolean {
    return this.healthy;
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  async start(): Promise<void> {
    console.log('[CEA] Starting Chief Executive Agent...');
    console.log(`[CEA] ${Object.keys(SUBAGENT_DEFS).length} specialist agents registered as subagents`);

    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      'You are now active. Acknowledge briefly and wait for user instructions.',
      { agents: SUBAGENT_DEFS },
    );

    this.healthy = true;
    console.log('[CEA] CEA is active and ready');

    // Process any queued messages
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      await this.sendMessage(msg);
    }
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.healthy) {
      console.log('[CEA] Not healthy, queueing message');
      this.messageQueue.push(content);
      return;
    }

    // Stop any running CEA before spawning a new run for this message
    // Each user message gets a fresh CEA run with the full system prompt
    try {
      await this.agentManager.stopAgent(CEA_CONFIG_ID);
    } catch {
      // Agent may not be active — that's fine
    }

    console.log(`[CEA] Processing message: ${content.slice(0, 80)}...`);
    await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      content,
      { agents: SUBAGENT_DEFS },
    );
  }

  async stop(): Promise<void> {
    if (this.handle) {
      await this.agentManager.stopAgent(CEA_CONFIG_ID);
      this.handle = null;
      this.healthy = false;
    }
    console.log('[CEA] Stopped');
  }

  async restart(): Promise<void> {
    console.log('[CEA] Restarting...');
    await this.stop();
    await this.start();
  }
}
