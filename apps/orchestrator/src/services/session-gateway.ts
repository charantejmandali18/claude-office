import type { PrismaClient } from '@prisma/client';
import type { AgentEvent } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';
import { AgentDefinitionBuilder } from './agent-definition-builder.js';
import { generateEventId, generateRunId } from '@rigelhq/shared';

const TEAM_LEAD_SYSTEM_PROMPT = `You are the Team Lead of RigelHQ — an AI engineering organization with 20 specialist agents.

## Your Role
You are a pure orchestrator. You NEVER do work yourself — no Bash, no Read, no Write, no code. You delegate ALL work to teammates.

## How You Work

### Step 1: Create a Team (once per project)
On your FIRST task, use the \`TeamCreate\` tool to create a team:
\`\`\`
TeamCreate({ team_name: "rigelhq-team", description: "RigelHQ engineering team" })
\`\`\`
If a team already exists, skip this step.

### Step 2: Spawn Teammates
Use the \`Agent\` tool with \`team_name\` and \`name\` to spawn real teammates.

IMPORTANT: In each teammate's prompt, you MUST include:

1. **The project path** — If the user is working on a specific project, tell the teammate the FULL ABSOLUTE PATH.
   Example: "The project is at /Users/charantej/charan_personal_projects/landing-page-website-practice. cd to that directory FIRST before doing any work."
   If no specific project is mentioned, the teammate works in the current directory.

2. **Full task context** — Don't just say "fix the landing page". Include what the user said, what you know from the conversation, and what specifically needs to be done.

3. **The collaboration block**:
\`\`\`
You are the [Role] on the RigelHQ team.

WORKING DIRECTORY: [Include the full path here. cd to it FIRST before any work.]

COLLABORATION: You work in a team. Before starting work that affects other specialists, use SendMessage to coordinate:
- If you change an API → SendMessage to frontend-engineer about the change
- If you change DB schema → SendMessage to backend-engineer
- If you find a bug → SendMessage to qa-tester
- If you need architecture guidance → SendMessage to technical-architect
- Always SendMessage your results to team-lead when done.

Use SendMessage like this: SendMessage({ to: "teammate-name", content: "your message" })
\`\`\`

### Step 3: Communicate via SendMessage
Use \`SendMessage\` to communicate with teammates:
\`\`\`
SendMessage({ to: "frontend-engineer", content: "Please also add form validation" })
\`\`\`

## Available Specialists (use as \`name\` when spawning)
| Name | Role |
|------|------|
| frontend-engineer | Senior Frontend Engineer — React, CSS, UI |
| backend-engineer | Senior Backend Engineer — APIs, DB, server |
| app-developer | Senior Mobile App Developer |
| github-repos-owner | Repository Owner — git, branches, PRs |
| code-review-engineer | Code Review Specialist — reviews, quality |
| devops-engineer | DevOps Engineer — CI/CD, Docker, deploy |
| infra-engineer | Infrastructure Engineer — cloud, Terraform |
| dba-engineer | Database Administrator — schemas, migrations |
| platform-engineer | Platform Engineer — build systems |
| qa-tester | Senior QA Engineer — testing, bugs |
| automation-qa-tester | QA Automation Engineer — E2E tests |
| load-tester | Performance Test Engineer — load testing |
| security-engineer | Security Engineer — audits, vulnerabilities |
| technical-architect | Solutions Architect — system design |
| product-manager | Senior Product Manager — specs, requirements |
| ux-designer | Senior UX Designer — wireframes, design |
| sre-engineer | Site Reliability Engineer — monitoring |
| noc-engineer | NOC Engineer — alerts, uptime |
| operations-engineer | Operations Engineer — runbooks |
| projects-manager | Technical Program Manager — timelines |

## CRITICAL RULES
- ALWAYS use TeamCreate first (once), then Agent with team_name + name.
- Do NOT set run_in_background. Let teammates run in the foreground so you can see their results.
- For multi-domain tasks, spawn multiple teammates — they will run in parallel automatically.
- NEVER do work yourself — always delegate to a named specialist.
- Use \`SendMessage\` when you need to communicate with a running teammate.
- After all teammates complete, summarize their results concisely for the user.
- Keep your summaries short.

## AFTER TEAMMATES REPORT BACK
When all teammates have sent their results via SendMessage:
1. Present a concise summary to the user.
2. That's it. You're done. Do not do anything else.

Teammates manage their own lifecycle — they exit on their own after reporting.
You have ZERO responsibility for their lifecycle. Do not mention their status.
Do not call Agent again. Do not call SendMessage. Just summarize and stop.
`;

interface ActiveSession {
  handle: SessionHandle;
  projectName: string;
  activeAgents: Set<string>;  // configIds of currently active specialists
  /** Map tool_use_id -> agent configId for resolving task events */
  toolUseToAgent: Map<string, string>;
}

export class SessionGateway {
  private sessions = new Map<string, ActiveSession>();       // sessionId -> ActiveSession
  private configToSession = new Map<string, string>();       // configId -> sessionId (for lookup)
  private activeCollabs = new Map<string, string>();         // agentId -> collaborationId (for line lifecycle)
  private agentDefBuilder: AgentDefinitionBuilder;
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private adapter: GatewayAdapter,
    private eventBus: EventBus,
    private db: PrismaClient,
    private idleTimeoutMs: number = 30 * 60 * 1000,  // 30 min default
  ) {
    this.agentDefBuilder = new AgentDefinitionBuilder();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Create a new session for a project */
  async createSession(projectName: string, initialPrompt: string): Promise<string> {
    console.log(`[SessionGW] Creating session for project: ${projectName}`);

    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(event);
    };

    const configId = 'cea';  // Team lead uses the CEA configId for proper UI attribution
    const handle = await this.adapter.createSession(
      configId,
      initialPrompt,
      onEvent,
      {
        systemPrompt: TEAM_LEAD_SYSTEM_PROMPT,
      },
    );

    const sessionId = handle.sessionId || `pending-${Date.now()}`;

    const session: ActiveSession = {
      handle,
      projectName,
      activeAgents: new Set(),
      toolUseToAgent: new Map(),
    };

    this.sessions.set(sessionId, session);

    // Store in DB
    await this.db.session.upsert({
      where: { sessionId },
      update: { projectName, status: 'ACTIVE' },
      create: {
        projectName,
        sessionId,
        status: 'ACTIVE',
      },
    });

    this.resetIdleTimer(sessionId);
    console.log(`[SessionGW] Session created: ${sessionId} for ${projectName}`);
    return sessionId;
  }

  /** Send a follow-up message to an existing session */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session: ${sessionId}`);

    console.log(`[SessionGW] Sending message to ${sessionId}: ${message.slice(0, 80)}...`);

    await this.db.session.update({
      where: { sessionId },
      data: { status: 'ACTIVE' },
    });

    // V2 sessions are persistent — just send the message, stream is already running
    await session.handle.send(message);
    this.resetIdleTimer(sessionId);
  }

  /** List all sessions */
  async listSessions(): Promise<Array<{ sessionId: string; projectName: string; status: string }>> {
    const dbSessions = await this.db.session.findMany({
      where: { status: { not: 'STOPPED' } },
      orderBy: { lastActive: 'desc' },
    });
    return dbSessions.map(s => ({
      sessionId: s.sessionId,
      projectName: s.projectName,
      status: s.status,
    }));
  }

  /** Check if a session exists and is active */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Stop a specific session */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.clearIdleTimer(sessionId);
    await session.handle.close();
    this.sessions.delete(sessionId);

    // Clean up configToSession reverse-lookup entries for this session
    for (const [configId, sid] of this.configToSession) {
      if (sid === sessionId) this.configToSession.delete(configId);
    }

    await this.db.session.update({
      where: { sessionId },
      data: { status: 'STOPPED' },
    });

    // Mark all active agents for this session as IDLE
    for (const agentId of session.activeAgents) {
      await this.db.agent.update({
        where: { configId: agentId },
        data: { status: 'IDLE', sessionId: null, taskId: null },
      }).catch(() => { /* agent row may not exist yet */ });
      await this.eventBus.publishStatus(agentId, 'IDLE');
    }

    console.log(`[SessionGW] Session stopped: ${sessionId}`);
  }

  /** Stop all sessions */
  async stopAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    await this.adapter.stopAll();
    this.sessions.clear();
    this.configToSession.clear();
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  /** Handle events from the CLI stdout stream.
   *  Status updates for ALL agents (including CEA) come from hooks now.
   *  This only publishes raw events to the bus for the activity feed + chat. */
  private async handleEvent(event: AgentEvent): Promise<void> {
    // Publish all events to the bus (UI gets everything — activity feed, chat)
    await this.eventBus.publish(event);
  }

  // ---------------------------------------------------------------------------
  // Idle / hibernate
  // ---------------------------------------------------------------------------

  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    this.idleTimers.set(sessionId, setTimeout(() => {
      this.hibernateSession(sessionId).catch(console.error);
    }, this.idleTimeoutMs));
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  private async hibernateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    console.log(`[SessionGW] Hibernating session: ${sessionId}`);
    await session.handle.close();
    this.sessions.delete(sessionId);
    await this.db.session.update({
      where: { sessionId },
      data: { status: 'IDLE' },
    });
  }
}
