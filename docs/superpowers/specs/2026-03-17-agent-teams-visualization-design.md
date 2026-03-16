# RigelHQ: Agent Teams Visualization Architecture

**Date:** 2026-03-17
**Status:** Draft
**Author:** Claude + Charan

## Overview

Migrate RigelHQ from a custom orchestration architecture (CEA Manager, delegation markers, manual agent spawning) to using Claude Code's native **Agent Teams** feature. The orchestrator becomes a thin **observation and relay layer** — Claude Code handles all agent coordination natively, and we visualize everything in the existing virtual office UI.

## Core Principle

**We do not orchestrate. Claude Code orchestrates. We observe and visualize.**

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────┐
│  Web UI (Next.js + React + SVG)                      │
│  - Virtual office floor with agent avatars            │
│  - Three-tier avatars: lead, specialist, baby agent   │
│  - Communication lines (lead→spec, spec→spec, spec→baby) │
│  - Chat panel streaming team lead output              │
│  - Session switcher for multiple projects             │
└──────────────────┬───────────────────────────────────┘
                   │ WebSocket (socket.io)
                   │
┌──────────────────▼───────────────────────────────────┐
│  Session Gateway (Node.js — thin relay)               │
│  - Session manager (create/resume/list sessions)      │
│  - SDK event streamer (query iterator → WebSocket)    │
│  - Hook receiver (HTTP POST endpoint)                 │
│  - File watcher (~/.claude/teams/, ~/.claude/tasks/)  │
│  - Redis event bus (persistence/replay)               │
│  - PostgreSQL (session metadata, chat history)        │
└──────────────────┬───────────────────────────────────┘
                   │ SDK query() + env var
                   │
┌──────────────────▼───────────────────────────────────┐
│  Claude Code (terminal, native Agent Teams)           │
│  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (global)      │
│  - Team lead session (one per project)                │
│  - Spawns specialist teammates dynamically            │
│  - Teammates communicate via mailbox                  │
│  - Teammates can spawn sub-agents (Explore, Plan)     │
│  - Hooks notify Session Gateway of all activity       │
└──────────────────────────────────────────────────────┘
```

### How It Works

1. User sends a message via the web UI chat panel
2. Session Gateway calls SDK `query()` with the message, resuming the project's session if it exists
3. The `query()` call includes `agents: { ...21 predefined specialists }` and `agentProgressSummaries: true`
4. Claude Code starts as the team lead, decides which specialists to spawn
5. Specialists are spawned as full Claude Code instances (Agent Teams)
6. SDK iterator streams all events back: assistant messages, task lifecycle, tool use
7. Claude Code hooks fire HTTP POSTs to Session Gateway for teammate-level events
8. Session Gateway transforms events and pushes to UI via WebSocket
9. UI renders: agent avatars light up, communication lines appear, chat streams text

### Multi-Project Sessions

Each project context is a persistent Claude Code session with its own `sessionId`. Users can:
- Work on Project A, switch to Project B in the UI
- Each project maintains full conversation context
- Switching back resumes the session (via SDK `resume: sessionId`)
- All active specialists for each project are tracked independently

```
Session Store:
  project-1: { sessionId: "abc-123", status: "active", agents: [frontend-engineer, backend-engineer] }
  project-2: { sessionId: "def-456", status: "idle", agents: [] }
```

## Agent Definitions

### How Agents Are Defined

All 21 specialist agents are defined programmatically using the SDK's `AgentDefinition` type and passed to `query()` via the `agents` parameter:

```typescript
const agents: Record<string, AgentDefinition> = {
  'frontend-engineer': {
    description: 'Frontend specialist — React, CSS, UI components, responsive design',
    prompt: `You are the Frontend Engineer at RigelHQ.
      ${fullPersona}           // background, communication style, principles
      ${responsibilities}      // core responsibilities
      ${capabilities}          // languages, frameworks, tools
      ${qualityStandards}      // coding standards, review checklist
      ${collaborationRules}    // who you work with, report to
    `,
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
    model: 'sonnet',  // optional: can use different models per agent
  },
  'backend-engineer': { ... },
  // ... 19 more
};
```

### Agent Definition Source

Existing agent configs in `packages/shared/src/constants/agent-configs.ts` (86KB, 21 detailed personas) are converted into `AgentDefinition` objects by a new `agent-definition-builder.ts` service. This preserves all the rich persona data (background, communication style, principles, capabilities, collaboration rules) in each agent's `prompt` field.

The `description` field is kept concise (1-2 sentences) since the team lead sees all 21 descriptions to decide who to invoke.

### Agent Hierarchy

```
Team Lead (Claude Code main session)
  ├── frontend-engineer (AgentDefinition, spawned on demand)
  │     ├── Explore (built-in, spawned by specialist)
  │     └── Plan (built-in, spawned by specialist)
  ├── backend-engineer (AgentDefinition, spawned on demand)
  ├── devops-engineer (AgentDefinition, spawned on demand)
  │     └── Explore (built-in)
  └── ... up to 21 specialists, each can spawn built-in sub-agents
```

- Team lead decides which specialists to invoke based on the task
- Specialists can spawn Claude Code's built-in agents (Explore, Plan, general-purpose) if given the `Agent` tool
- Specialists can communicate with each other via Agent Teams mailbox

## Event Flow

### Event Sources

Three sources feed the UI:

**1. SDK Query Iterator (primary)**
The `query()` async iterator streams all messages from the team lead session:

| SDK Message Type | Fields | UI Effect |
|-----------------|--------|-----------|
| `assistant` | `message.content[].text` | Chat panel: team lead text streams in |
| `tool_use` (name=Agent, input.subagent_type) | `block.input` | Communication line: Team Lead → Specialist |
| `task_started` | `task_id`, `description`, `session_id` | Agent avatar: IDLE → THINKING, line activates |
| `task_progress` + `last_tool_name` | `task_id`, `last_tool_name` | Agent avatar: TOOL_CALLING, tool badge |
| `task_progress` + `summary` | `task_id`, `summary` | Speech bubble on agent avatar |
| `task_notification` (completed) | `task_id`, `status`, `summary` | Agent: → IDLE, line fades, result in chat |
| `task_notification` (failed) | `task_id`, `status` | Agent: → ERROR, error in chat |
| `result` | `subtype` | Session complete or errored |

**2. Claude Code Hooks (supplementary)**
Shell commands that POST JSON to `http://localhost:4000/hooks/event`:

| Hook Event | Key Fields | UI Effect |
|------------|-----------|-----------|
| `SubagentStart` | agent context | Baby avatar spawns near parent specialist |
| `SubagentStop` | agent context | Baby avatar fades out |
| `TeammateIdle` | `teammate_name`, `team_name` | Agent avatar: → IDLE |
| `TaskCompleted` | `task_id`, `teammate_name` | Agent task completion confirmation |
| `PostToolUse` | `tool_name`, agent context | Tool badge flash on avatar |

**3. File System Watching (backup/enrichment)**

| Path | Trigger | UI Effect |
|------|---------|-----------|
| `~/.claude/teams/{team}/config.json` | Team member change | Update active teammate roster |
| `~/.claude/tasks/{team}/*.json` | Task state change | Confirm task status in UI |

### Hook Configuration

A forwarding script at `~/.claude/hooks/notify-rigelhq.sh`:

```bash
#!/bin/bash
cat | curl -s -X POST http://localhost:4000/hooks/event \
  -H 'Content-Type: application/json' -d @-
```

Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SubagentStart": [{ "type": "command", "command": "~/.claude/hooks/notify-rigelhq.sh" }],
    "SubagentStop": [{ "type": "command", "command": "~/.claude/hooks/notify-rigelhq.sh" }],
    "TeammateIdle": [{ "type": "command", "command": "~/.claude/hooks/notify-rigelhq.sh" }],
    "TaskCompleted": [{ "type": "command", "command": "~/.claude/hooks/notify-rigelhq.sh" }],
    "PostToolUse": [{ "type": "command", "command": "~/.claude/hooks/notify-rigelhq.sh" }]
  }
}
```

### Event Transformation

Session Gateway transforms raw events into UI events:

```typescript
// SDK task_started → UI agent activation
{
  type: 'agent:status',
  configId: resolveAgentId(taskEvent.description), // map task description → agent config ID
  status: 'THINKING',
  taskId: taskEvent.task_id,
  sessionId: taskEvent.session_id,
}

// SDK task_progress → UI tool usage
{
  type: 'agent:tool',
  configId: resolveAgentId(taskEvent.description),
  tool: taskEvent.last_tool_name,
  summary: taskEvent.summary,
}

// SDK tool_use (Agent) → UI communication line
{
  type: 'communication:start',
  from: 'team-lead',
  to: toolUseInput.subagent_type, // e.g., 'frontend-engineer'
  taskId: taskEvent.task_id,
}

// Hook SubagentStart → UI baby agent spawn
{
  type: 'baby-agent:spawn',
  parentAgentId: hookPayload.agent_id,
  agentType: hookPayload.agent_type, // 'Explore', 'Plan', etc.
  taskId: hookPayload.task_id,
}
```

## Frontend Design

### Avatar Tiers

| Tier | Radius | Who | Position | Lifecycle |
|------|--------|-----|----------|-----------|
| Team Lead | 30px | CEO/Orchestrator | Fixed desk in CEO Suite | Always present |
| Specialist | 26px | 21 predefined agents | Fixed desk positions per zone | IDLE by default, activates on task_started |
| Baby Agent | 16px | Explore, Plan, general-purpose | Offset 20px from parent specialist | Spawns on SubagentStart, fades on SubagentStop |

**Baby Agent Component:**
- Pop-in animation (scale 0 → 1, spring easing)
- Positioned bottom-right of parent specialist
- Subtle dotted connecting line to parent
- Icon: magnifying glass (Explore), clipboard (Plan), gear (general-purpose)
- Fade-out + scale-down animation on completion (400ms)
- Status ring matches parent's color scheme but thinner

### Communication Lines

| Connection | Style | Width | When |
|------------|-------|-------|------|
| Team Lead → Specialist | Solid line, animated dash | 2px | Team lead spawns specialist via Agent tool |
| Specialist ↔ Specialist | Dashed line, bidirectional arrows | 1.5px | Mailbox message between teammates |
| Specialist → Baby Agent | Dotted line | 1px, same color as parent | Specialist spawns sub-agent |

**Line Lifecycle:**
1. Line appears with fade-in (200ms) when connection established
2. Animated dashing shows data flow direction
3. Pulse/glow when active communication (message being sent)
4. Fade-out (600ms) when task completes or agent goes idle

**Color Assignment:**
- Each active task gets a unique color from the 8-color palette (teal, amber, rose, violet, lime, cyan, pink, green)
- Child lines (specialist → baby) inherit parent's color
- Specialist ↔ specialist lines get their own color

### Chat Panel

- **Live stream** of team lead's assistant messages
- **Session tabs** at the top for switching between projects
- **Agent attribution**: specialist outputs shown with agent icon + name prefix
- **User input** at the bottom — sends to active session
- **Status bar**: shows active session name, number of active agents, team status

### Session Switcher

New component (sidebar tabs or top-bar dropdown):
- Lists all project sessions with status indicator (green=active, yellow=idle, gray=stopped)
- Click to switch — loads that session's chat history and restores agent state
- "New Session" button creates a new project context
- Session name editable (defaults to first prompt summary)

### Agent Store Changes

```typescript
// New state additions
interface AgentStore {
  // Existing
  agents: Map<string, AgentState>
  collaborations: Map<string, ActiveCollaboration>
  messages: ChatMessage[]
  events: AgentEvent[]
  connected: boolean

  // New
  sessions: Map<string, SessionState>        // project sessions
  activeSessionId: string | null             // currently viewed session
  babyAgents: Map<string, BabyAgentState>   // sub-sub-agents

  // New actions
  switchSession(sessionId: string): void
  createSession(projectName: string): void
  addBabyAgent(taskId: string, parentId: string, type: string): void
  removeBabyAgent(taskId: string): void
}

interface SessionState {
  sessionId: string
  projectName: string
  status: 'active' | 'idle' | 'stopped'
  messages: ChatMessage[]
  activeAgents: Set<string>  // configIds of active specialists
  createdAt: number
  lastActive: number
}

interface BabyAgentState {
  taskId: string
  parentAgentId: string
  type: 'Explore' | 'Plan' | 'general-purpose'
  icon: string
  position: { x: number; y: number }  // offset from parent
  status: AgentStatus
  spawnedAt: number
}
```

## Backend Design

### Services Removed

| Service | Reason |
|---------|--------|
| `cea-manager.ts` | Claude Code IS the orchestrator — no need for CEA |
| `agent-manager.ts` delegation logic | SDK Agent tool handles spawning |
| `agent-manager.ts` consultation logic | Agent Teams mailbox handles peer communication |
| `collaboration-manager.ts` | Replaced by direct event mapping from SDK + hooks |
| `agent-config-loader.ts` | Replaced by agent-definition-builder.ts |

### Services Kept (Adapted)

| Service | Changes |
|---------|---------|
| `websocket-server.ts` | Simplified — relays events, session switching, chat routing |
| `event-bus.ts` | Same — Redis pub/sub for persistence/replay |
| `db-service.ts` | Same |
| `redis-service.ts` | Same |
| `task-manager.ts` | Simplified — reads from SDK events instead of custom tracking |

### New Services

**`session-gateway.ts`** — Core service replacing CEAManager + AgentManager orchestration:

```typescript
class SessionGateway {
  // Session lifecycle
  createSession(projectName: string, initialPrompt: string): Promise<string>
    // Calls SDK query() with agents definitions + agentProgressSummaries
    // Stores session metadata in DB
    // Starts streaming events to WebSocket

  sendMessage(sessionId: string, message: string): Promise<void>
    // Calls SDK query() with resume: sessionId
    // Streams response events to WebSocket

  listSessions(): Promise<SessionInfo[]>
    // Returns all project sessions with status

  stopSession(sessionId: string): Promise<void>
    // Aborts the active query for this session

  // Internal
  private streamEvents(sessionId: string, iterator: Query): void
    // Iterates SDK messages, transforms, pushes to WebSocket + Redis
}
```

**`agent-definition-builder.ts`** — Converts existing agent configs to SDK format:

```typescript
class AgentDefinitionBuilder {
  buildAll(): Record<string, AgentDefinition>
    // Reads from AGENT_CONFIGS (packages/shared)
    // Returns { 'frontend-engineer': { description, prompt, tools }, ... }

  buildOne(configId: string): AgentDefinition
    // Single agent definition
}
```

**`hook-receiver.ts`** — HTTP endpoint for Claude Code hooks:

```typescript
class HookReceiver {
  // Express/HTTP handler
  handleEvent(req: Request): void
    // Parses hook JSON payload
    // Maps to UI events
    // Publishes to WebSocket via event bus
}
```

**`file-watcher.ts`** — Watches Agent Teams file system:

```typescript
class FileWatcher {
  watch(): void
    // fs.watch on ~/.claude/teams/ and ~/.claude/tasks/
    // Emits events on team config changes or task state updates
}
```

### Adapter Changes

**`adapter.ts`** — Simplified interface:

```typescript
interface GatewayAdapter {
  createSession(
    prompt: string,
    agents: Record<string, AgentDefinition>,
    onEvent: EventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle>

  resumeSession(
    sessionId: string,
    message: string,
    onEvent: EventCallback,
  ): Promise<void>

  stopSession(sessionId: string): Promise<void>

  listSessions(): Promise<SessionInfo[]>
}

interface SessionHandle {
  sessionId: string
  query: Query  // SDK query interface for stopTask(), interrupt()
  abort: AbortController
}

interface SessionOptions {
  agentProgressSummaries?: boolean
  cwd?: string
}
```

**`claude-adapter.ts`** — Simplified implementation:

```typescript
class ClaudeAdapter implements GatewayAdapter {
  async createSession(prompt, agents, onEvent, options?) {
    const abort = new AbortController();
    const iter = query({
      prompt,
      options: {
        abortController: abort,
        agents,
        agentProgressSummaries: options?.agentProgressSummaries ?? true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 inherited from env
      },
    });
    // Stream events in background...
    return { sessionId, query: iter, abort };
  }

  async resumeSession(sessionId, message, onEvent) {
    const iter = query({
      prompt: message,
      options: {
        resume: sessionId,
        agentProgressSummaries: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });
    // Stream events...
  }
}
```

## Database Schema Changes

### New Model: Session

```prisma
model Session {
  id          String        @id @default(cuid())
  projectName String
  sessionId   String        @unique  // Claude Code session ID
  teamName    String?                // Agent Teams team name (from config.json)
  status      SessionStatus @default(ACTIVE)
  createdAt   DateTime      @default(now())
  lastActive  DateTime      @updatedAt
  metadata    Json?                  // team config, active agent list
  messages    Message[]              // chat history for this session
}

enum SessionStatus {
  ACTIVE
  IDLE
  STOPPED
}
```

### Modified Model: Agent

```prisma
model Agent {
  id          String      @id @default(cuid())
  configId    String      @unique
  name        String
  role        String
  icon        String      @default("robot")
  status      AgentStatus @default(OFFLINE)
  // Removed: pid, startedAt (we don't manage processes)
  // Added:
  sessionId   String?     // which session this agent is active in
  taskId      String?     // current SDK task ID
  parentAgentId String?   // for baby agents — links to specialist configId
  metadata    Json?
}
```

### Kept As-Is

- `Message` — chat messages (now linked to Session)
- `Conversation` — can be repurposed as Session grouping
- `Task` — tracks tasks (populated from SDK task events)
- `ActivityLog` — agent event log
- `Project` — project metadata

## Entry Point Changes

### `index.ts` — Simplified Startup

```typescript
async function main() {
  const config = loadConfig();
  const db = getDb();
  const redisPub = getRedisPublisher(config.REDIS_URL);
  const redisSub = getRedisSubscriber(config.REDIS_URL);
  const eventBus = new EventBus(redisPub, redisSub);
  const adapter = new ClaudeAdapter();

  // New services
  const agentDefBuilder = new AgentDefinitionBuilder();
  const sessionGateway = new SessionGateway(adapter, agentDefBuilder, eventBus, db);
  const hookReceiver = new HookReceiver(eventBus);
  const fileWatcher = new FileWatcher(eventBus);

  // HTTP server for hooks + WebSocket
  const httpServer = http.createServer(hookReceiver.handler());
  const wsServer = new WebSocketServer(httpServer, eventBus);
  wsServer.setSessionGateway(sessionGateway);
  wsServer.setDb(db);

  // Seed agent metadata (for UI display — no status management)
  await seedAgentMetadata(db);

  httpServer.listen(config.RIGELHQ_ORCHESTRATOR_PORT);
  fileWatcher.start();

  console.log('[RigelHQ] Session Gateway ready');
  // No CEA to start — Claude Code handles orchestration on first message
}
```

## WebSocket Events

### Backend → Frontend

| Event | Payload | When |
|-------|---------|------|
| `session:created` | `{ sessionId, projectName }` | New session started |
| `session:status` | `{ sessionId, status }` | Session became active/idle/stopped |
| `chat:stream` | `{ sessionId, text, agentId? }` | Team lead or specialist text output |
| `agent:status` | `{ configId, status, taskId? }` | Agent status changed |
| `agent:tool` | `{ configId, tool, phase }` | Agent using a tool |
| `agent:speech` | `{ configId, text }` | Agent progress summary |
| `communication:start` | `{ from, to, taskId, color }` | Line between agents |
| `communication:end` | `{ from, to, taskId }` | Line should fade |
| `baby-agent:spawn` | `{ taskId, parentId, type, icon }` | Sub-sub-agent appeared |
| `baby-agent:remove` | `{ taskId }` | Sub-sub-agent finished |
| `agent:status-snapshot` | `[{ configId, status }]` | Initial state on connect |
| `session:list` | `[{ sessionId, projectName, status }]` | All sessions on connect |

### Frontend → Backend

| Event | Payload | When |
|-------|---------|------|
| `chat:message` | `{ sessionId?, message, projectName? }` | User sends message |
| `session:switch` | `{ sessionId }` | User switches project tab |
| `session:create` | `{ projectName }` | User clicks "New Session" |
| `session:stop` | `{ sessionId }` | User stops a session |

## Implementation Notes

### Environment Variable

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set globally in `~/.zshrc`. All Claude Code processes (CLI and SDK subprocess) inherit this automatically. No per-session configuration needed.

### Agent ID Resolution

SDK task events contain `description` and `task_id` but not a direct `configId`. We resolve the agent identity by:
1. Matching the `subagent_type` from the Agent tool call that started the task
2. Tracking `tool_use_id` → `task_id` mapping when the Agent tool is called
3. Falling back to keyword matching in task `description` against known agent names

### Session Persistence

Sessions are persisted by Claude Code itself (in `~/.claude/projects/`). Our DB stores only metadata (session ID, project name, status). On backend restart, we can rediscover sessions via `listSessions()` SDK call and reconcile.

### Mock Mode

For development without real Claude sessions, keep a mock adapter that simulates:
- Team lead assistant messages
- Fake task_started/progress/notification events
- Simulated specialist activity with realistic timing
- This powers the "living office" demo mode

### Error Handling

- If SDK `query()` fails, mark session as errored, notify UI
- If hook POST fails, Claude Code continues unaffected (hooks are fire-and-forget)
- If file watcher misses events, SDK stream is the source of truth
- On WebSocket reconnect, send full state snapshot (sessions + agent statuses)
