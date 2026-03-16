import type { AgentConfig } from '@rigelhq/shared';
import { AGENT_CONFIGS, AGENT_CONFIG_MAP } from '@rigelhq/shared';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

/** The CEA (Chief Executive Agent) is the team lead — it runs as the main session, not as a subagent. */
const TEAM_LEAD_ID = 'cea';

/**
 * Converts AgentConfig objects into Claude Agent SDK `AgentDefinition` records
 * suitable for passing to the `query()` call's `agents` parameter.
 *
 * Leverages `AgentConfigLoader` for system prompt generation and tool resolution
 * so that prompt logic stays in one place.
 */
export class AgentDefinitionBuilder {
  /**
   * Build all specialist agent definitions (excludes the team lead).
   * Returns a Record keyed by agent ID, ready to pass as `agents` to `query()`.
   */
  buildAll(): Record<string, AgentDefinition> {
    const agents: Record<string, AgentDefinition> = {};
    for (const config of AGENT_CONFIGS) {
      if (config.id === TEAM_LEAD_ID) continue;
      agents[config.id] = this.buildOne(config.id);
    }
    return agents;
  }

  /**
   * Build a single agent definition by config ID.
   * Throws if the config ID is not found.
   */
  buildOne(configId: string): AgentDefinition {
    const config = AGENT_CONFIG_MAP.get(configId);
    if (!config) {
      throw new Error(`Unknown agent config: ${configId}`);
    }

    return {
      description: this.buildDescription(config),
      prompt: this.buildPrompt(config),
      tools: this.resolveTools(config),
    };
  }

  /**
   * Build a subset of agent definitions for specific IDs only.
   * Useful when activating a limited set of agents for a focused task.
   */
  buildSubset(configIds: string[]): Record<string, AgentDefinition> {
    const agents: Record<string, AgentDefinition> = {};
    for (const id of configIds) {
      if (id === TEAM_LEAD_ID) continue;
      agents[id] = this.buildOne(id);
    }
    return agents;
  }

  /**
   * Build definitions for only the always-active agents (excludes team lead).
   */
  buildActive(): Record<string, AgentDefinition> {
    const agents: Record<string, AgentDefinition> = {};
    for (const config of AGENT_CONFIGS) {
      if (config.id === TEAM_LEAD_ID) continue;
      if (config.status !== 'always_active') continue;
      agents[config.id] = this.buildOne(config.id);
    }
    return agents;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Short 1-2 sentence description the team lead sees when deciding which
   * agent to delegate to. Includes role and domain keywords.
   */
  private buildDescription(config: AgentConfig): string {
    const domainList = config.capabilities.domains.join(', ');
    return `${config.name} — ${config.role}. Seniority: ${config.seniority}. Domains: ${domainList}.`;
  }

  /**
   * Build the full system prompt from the AgentConfig, including persona,
   * responsibilities, capabilities, collaboration rules, and quality standards.
   */
  private buildPrompt(config: AgentConfig): string {
    const lines: string[] = [];

    lines.push(`# ${config.name} — ${config.role}`);
    lines.push(`Seniority: ${config.seniority}\n`);

    lines.push(`## Background\n${config.persona.background}\n`);
    lines.push(`## Communication Style\n${config.persona.communication_style}\n`);

    lines.push(`## Core Principles`);
    for (const p of config.persona.principles) lines.push(`- ${p}`);

    lines.push(`\n## Core Responsibilities`);
    for (const r of config.core_responsibilities) lines.push(`- ${r}`);

    lines.push(`\n## Capabilities`);
    if (config.capabilities.languages?.length) {
      lines.push(`Languages: ${config.capabilities.languages.join(', ')}`);
    }
    if (config.capabilities.frameworks?.length) {
      lines.push(`Frameworks: ${config.capabilities.frameworks.join(', ')}`);
    }
    lines.push(`Domains: ${config.capabilities.domains.join(', ')}`);

    lines.push(`\n## Collaboration`);
    lines.push(`Reports to: ${config.collaboration.reports_to}`);
    if (config.collaboration.works_closely_with?.length) {
      lines.push(`Works closely with: ${config.collaboration.works_closely_with.join(', ')}`);
    }
    if (config.collaboration.manages?.length) {
      lines.push(`Manages: ${config.collaboration.manages.join(', ')}`);
    }

    lines.push(`\n## Quality Standards`);
    for (const q of config.quality_standards) lines.push(`- ${q}`);

    if (config.red_flags?.length) {
      lines.push(`\n## Anti-Patterns (Avoid)`);
      for (const rf of config.red_flags) lines.push(`- ${rf}`);
    }

    if (config.review_checklist?.length) {
      lines.push(`\n## Review Checklist`);
      for (const rc of config.review_checklist) lines.push(`- ${rc}`);
    }

    return lines.join('\n');
  }

  /**
   * Resolve the config's tool list to SDK-recognised tool names.
   * Only keeps tools that are valid in the Claude Agent SDK context.
   * Falls back to a sensible default set if the config specifies none.
   */
  private resolveTools(config: AgentConfig): string[] {
    const SDK_TOOL_NAMES = new Set([
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Grep',
      'Glob',
      'Agent',
      'WebSearch',
      'WebFetch',
      'NotebookEdit',
    ]);

    const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];

    const matched = config.capabilities.tools.filter(t => SDK_TOOL_NAMES.has(t));
    return matched.length > 0 ? matched : DEFAULT_TOOLS;
  }
}

export const agentDefinitionBuilder = new AgentDefinitionBuilder();
