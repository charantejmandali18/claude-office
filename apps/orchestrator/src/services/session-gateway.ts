import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus, EventStream } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';
import { AgentDefinitionBuilder } from './agent-definition-builder.js';
import { generateEventId, generateRunId } from '@rigelhq/shared';

/** Color palette for communication lines */
const LINE_COLORS = ['#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4', '#ec4899', '#22c55e'];
let colorIndex = 0;

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
Use the \`Agent\` tool with \`team_name\` and \`name\` to spawn real teammates:
\`\`\`
Agent({
  name: "frontend-engineer",
  team_name: "rigelhq-team",
  description: "Build the login page UI",
  prompt: "You are the Frontend Engineer. Build a login page with React...",
  run_in_background: true
})
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
      {},  // No predefined agents — team lead uses TeamCreate + Agent with team_name
      onEvent,
      {
        systemPrompt: TEAM_LEAD_SYSTEM_PROMPT,
        agentProgressSummaries: true,
      },
    );

    // Wait briefly for session ID to be populated from the init message
    const waitForSession = async (): Promise<string> => {
      for (let i = 0; i < 50; i++) {
        if (handle.sessionId) return handle.sessionId;
        await new Promise(r => setTimeout(r, 100));
      }
      // Fallback: generate a temporary session ID
      return `pending-${Date.now()}`;
    };
    const sessionId = await waitForSession();
    handle.sessionId = sessionId;

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

    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(event);
    };

    await this.db.session.update({
      where: { sessionId },
      data: { status: 'ACTIVE' },
    });

    await this.adapter.resumeSession(session.handle, message, onEvent);
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
    await this.adapter.stop(session.handle);
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

  /** Handle events from the SDK stream */
  private async handleEvent(event: AgentEvent): Promise<void> {
    // Publish all events to the bus (UI gets everything)
    await this.eventBus.publish(event);

    // Track agent status based on event stream
    const agentId = event.agentId;
    const isCea = agentId === 'cea';
    const isKnownAgent = agentId && AGENT_ROLE_MAP.has(agentId);

    if (!isKnownAgent) return;

    const status = this.mapEventToStatus(event);
    if (!status) return;

    const roleMeta = AGENT_ROLE_MAP.get(agentId)!;

    await this.db.agent.upsert({
      where: { configId: agentId },
      update: {
        status,
        sessionId: (event.sessionKey as string) ?? null,
        taskId: (event.data.taskId as string) ?? null,
      },
      create: {
        configId: agentId,
        name: roleMeta.name,
        role: roleMeta.role,
        icon: roleMeta.icon,
        status,
      },
    });

    await this.eventBus.publishStatus(agentId, status);

    // Track active agents per session
    for (const [, session] of this.sessions) {
      if (status === 'IDLE' || status === 'OFFLINE') {
        session.activeAgents.delete(agentId);
      } else {
        session.activeAgents.add(agentId);
      }
    }

    // Emit collaboration events for communication lines (specialist agents only)
    if (!isCea && status === 'THINKING' && event.stream === 'lifecycle' && event.data.phase === 'start') {
      // Specialist started — draw line from CEA to specialist
      const color = LINE_COLORS[colorIndex % LINE_COLORS.length];
      colorIndex++;
      const collaborationId = `comm-${agentId}-${Date.now()}`;
      // Track so we can end it later
      this.activeCollabs.set(agentId, collaborationId);
      await this.eventBus.publish({
        id: generateEventId(),
        agentId: 'cea',
        runId: generateRunId(),
        seq: 1,
        stream: 'collaboration' as EventStream,
        timestamp: Date.now(),
        data: {
          phase: 'start',
          collaborationId,
          type: 'parallel',
          participants: ['cea', agentId],
          topic: `Delegated to ${roleMeta.name}`,
          color,
        },
      });
    } else if (!isCea && status === 'IDLE' && event.stream === 'lifecycle' && event.data.phase === 'end') {
      // Specialist finished — fade line
      const collaborationId = this.activeCollabs.get(agentId);
      if (collaborationId) {
        this.activeCollabs.delete(agentId);
        await this.eventBus.publish({
          id: generateEventId(),
          agentId,
          runId: generateRunId(),
          seq: 1,
          stream: 'collaboration' as EventStream,
          timestamp: Date.now(),
          data: {
            phase: 'end',
            collaborationId,
            participants: ['cea', agentId],
          },
        });
      }
    }
  }

  private mapEventToStatus(event: AgentEvent): AgentStatus | null {
    switch (event.stream) {
      case 'lifecycle':
        if (event.data.phase === 'start' || event.data.phase === 'thinking') return 'THINKING';
        if (event.data.phase === 'end') return 'IDLE';
        return null;
      case 'tool':
        return 'TOOL_CALLING';
      case 'assistant':
        return 'SPEAKING';
      case 'error':
        return 'ERROR';
      default:
        return null;
    }
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
    await this.adapter.stop(session.handle);
    await this.db.session.update({
      where: { sessionId },
      data: { status: 'IDLE' },
    });
    // Keep in sessions map so it can be resumed
  }
}
