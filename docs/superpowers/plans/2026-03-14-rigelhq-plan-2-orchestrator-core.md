# Orchestrator Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the orchestrator's runtime engine — adapter layer, event pipeline, agent lifecycle, task management, WebSocket server, and CEA manager.

**Architecture:** Adapter pattern abstracts Claude Agent SDK vs mock. EventBus dual-writes to Redis Pub/Sub (real-time) + Streams (persistent). AgentManager enforces process pool limits. Socket.io relays events to the web UI. CEAManager wraps the primary agent with health monitoring.

**Tech Stack:** Socket.io 4.x, ioredis 5.x, Prisma 6, @anthropic-ai/claude-agent-sdk, vitest

---

## File Structure

### Create:
- `apps/orchestrator/src/adapters/adapter.ts` — GatewayAdapter interface + AgentHandle type
- `apps/orchestrator/src/adapters/mock-adapter.ts` — Mock adapter simulating agent events
- `apps/orchestrator/src/adapters/claude-adapter.ts` — Real Claude Agent SDK adapter
- `apps/orchestrator/src/adapters/index.ts` — Barrel + factory function
- `apps/orchestrator/src/services/event-bus.ts` — Redis Pub/Sub + Streams dual-write
- `apps/orchestrator/src/services/agent-manager.ts` — Process pool + lifecycle
- `apps/orchestrator/src/services/task-manager.ts` — Task CRUD + state machine
- `apps/orchestrator/src/services/cea-manager.ts` — CEA orchestration + health
- `apps/orchestrator/src/services/websocket-server.ts` — Socket.io server
- `apps/orchestrator/vitest.config.ts` — Test configuration
- `apps/orchestrator/src/__tests__/mock-adapter.test.ts` — Mock adapter tests
- `apps/orchestrator/src/__tests__/event-bus.test.ts` — Event bus tests
- `apps/orchestrator/src/__tests__/agent-manager.test.ts` — Agent manager tests

### Modify:
- `apps/orchestrator/package.json` — Add vitest + claude-agent-sdk deps
- `apps/orchestrator/src/index.ts` — Wire all services together

---

## Chunk 1: Adapter Layer + Event Bus

### Task 1: Test infrastructure

**Files:**
- Modify: `apps/orchestrator/package.json`
- Create: `apps/orchestrator/vitest.config.ts`

- [ ] **Step 1: Add vitest and test deps to package.json**

Add to devDependencies:
```json
"vitest": "^3.0.0"
```

Add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create vitest config**

```typescript
// apps/orchestrator/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Install deps**

Run: `pnpm install`

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run: `pnpm --filter @rigelhq/orchestrator test`
Expected: "No test files found"

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/package.json apps/orchestrator/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add vitest test infrastructure to orchestrator"
```

---

### Task 2: Adapter interface

**Files:**
- Create: `apps/orchestrator/src/adapters/adapter.ts`

- [ ] **Step 1: Create adapter interface**

```typescript
// apps/orchestrator/src/adapters/adapter.ts
import type { AgentEvent } from '@rigelhq/shared';

export interface AgentHandle {
  id: string;
  configId: string;
  pid: number | null;
  stop(): Promise<void>;
}

export type AgentEventCallback = (event: AgentEvent) => void;

export interface GatewayAdapter {
  spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
  ): Promise<AgentHandle>;

  stop(handle: AgentHandle): Promise<void>;
  stopAll(): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`
Expected: PASS

---

### Task 3: Mock adapter

**Files:**
- Create: `apps/orchestrator/src/adapters/mock-adapter.ts`
- Create: `apps/orchestrator/src/__tests__/mock-adapter.test.ts`

- [ ] **Step 1: Write mock adapter test**

```typescript
// apps/orchestrator/src/__tests__/mock-adapter.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MockAdapter } from '../adapters/mock-adapter.js';
import type { AgentEvent } from '@rigelhq/shared';

describe('MockAdapter', () => {
  let adapter: MockAdapter;

  afterEach(async () => {
    if (adapter) await adapter.stopAll();
  });

  it('spawns an agent and emits lifecycle events', async () => {
    adapter = new MockAdapter();
    const events: AgentEvent[] = [];
    const handle = await adapter.spawn('backend-engineer', 'You are a backend engineer', 'Build an API', (e) => events.push(e));

    expect(handle.configId).toBe('backend-engineer');
    expect(handle.pid).toBeNull();

    // Wait for events to be emitted
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });

    // First event should be lifecycle start
    expect(events[0].stream).toBe('lifecycle');
    expect(events[0].data.phase).toBe('start');
    expect(events[0].agentId).toBe('backend-engineer');
  });

  it('stops an agent', async () => {
    adapter = new MockAdapter();
    const events: AgentEvent[] = [];
    const handle = await adapter.spawn('frontend-engineer', 'prompt', 'task', (e) => events.push(e));

    await handle.stop();

    const lastEvent = events[events.length - 1];
    expect(lastEvent.stream).toBe('lifecycle');
    expect(lastEvent.data.phase).toBe('end');
  });

  it('stopAll clears all agents', async () => {
    adapter = new MockAdapter();
    await adapter.spawn('agent-1', 'p', 't', () => {});
    await adapter.spawn('agent-2', 'p', 't', () => {});

    await adapter.stopAll();
    // No error means success — all timers cleared
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rigelhq/orchestrator test`
Expected: FAIL — MockAdapter doesn't exist

- [ ] **Step 3: Implement mock adapter**

```typescript
// apps/orchestrator/src/adapters/mock-adapter.ts
import type { AgentEvent } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback } from './adapter.js';

interface MockAgent {
  handle: AgentHandle;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  callback: AgentEventCallback;
  runId: string;
  seq: number;
}

const MOCK_TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Write'];
const MOCK_PHRASES = [
  'Analyzing the codebase structure...',
  'Implementing the requested changes...',
  'Running tests to verify...',
  'Reviewing the approach...',
  'Generating the solution...',
];

export class MockAdapter implements GatewayAdapter {
  private agents = new Map<string, MockAgent>();

  async spawn(
    configId: string,
    _systemPrompt: string,
    _taskPrompt: string,
    onEvent: AgentEventCallback,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const agent: MockAgent = {
      handle: {
        id: `mock-${configId}-${Date.now()}`,
        configId,
        pid: null,
        stop: () => this.stop({ id: `mock-${configId}-${Date.now()}`, configId, pid: null, stop: async () => {} }),
      },
      timer: null,
      stopped: false,
      callback: onEvent,
      runId,
      seq: 0,
    };

    // Fix the stop function to reference the correct agent
    agent.handle.stop = () => this.stopAgent(configId);

    this.agents.set(configId, agent);
    this.emitSequence(configId);

    return agent.handle;
  }

  private emitEvent(configId: string, stream: AgentEvent['stream'], data: AgentEvent['data']): void {
    const agent = this.agents.get(configId);
    if (!agent || agent.stopped) return;

    agent.seq += 1;
    const event: AgentEvent = {
      id: generateEventId(),
      agentId: configId,
      runId: agent.runId,
      seq: agent.seq,
      stream,
      timestamp: Date.now(),
      data,
    };
    agent.callback(event);
  }

  private emitSequence(configId: string): void {
    const agent = this.agents.get(configId);
    if (!agent) return;

    // Emit start immediately
    this.emitEvent(configId, 'lifecycle', { phase: 'start' });

    // Simulate: thinking → tool_calling → speaking → idle cycle
    const steps = [
      { delay: 500, fn: () => this.emitEvent(configId, 'lifecycle', { phase: 'thinking' }) },
      { delay: 1500, fn: () => {
        const tool = MOCK_TOOLS[Math.floor(Math.random() * MOCK_TOOLS.length)];
        this.emitEvent(configId, 'tool', { tool, phase: 'start' });
      }},
      { delay: 2500, fn: () => {
        this.emitEvent(configId, 'tool', { tool: 'Read', phase: 'end' });
      }},
      { delay: 3000, fn: () => {
        const text = MOCK_PHRASES[Math.floor(Math.random() * MOCK_PHRASES.length)];
        this.emitEvent(configId, 'assistant', { text });
      }},
      { delay: 4000, fn: () => {
        this.emitEvent(configId, 'lifecycle', { phase: 'end' });
      }},
    ];

    for (const step of steps) {
      const timer = setTimeout(() => {
        if (!agent.stopped) step.fn();
      }, step.delay);
      // Store last timer for cleanup
      agent.timer = timer;
    }
  }

  private async stopAgent(configId: string): Promise<void> {
    const agent = this.agents.get(configId);
    if (!agent) return;

    agent.stopped = true;
    if (agent.timer) clearTimeout(agent.timer);

    this.emitEvent(configId, 'lifecycle', { phase: 'end' });
    this.agents.delete(configId);
  }

  async stop(handle: AgentHandle): Promise<void> {
    await this.stopAgent(handle.configId);
  }

  async stopAll(): Promise<void> {
    const configIds = [...this.agents.keys()];
    await Promise.all(configIds.map(id => this.stopAgent(id)));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rigelhq/orchestrator test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/ apps/orchestrator/src/__tests__/
git commit -m "feat: add adapter interface and mock adapter with tests"
```

---

### Task 4: Claude adapter (stub)

**Files:**
- Create: `apps/orchestrator/src/adapters/claude-adapter.ts`
- Create: `apps/orchestrator/src/adapters/index.ts`

- [ ] **Step 1: Create Claude adapter**

```typescript
// apps/orchestrator/src/adapters/claude-adapter.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private handles = new Map<string, { abort: AbortController; configId: string }>();

  async spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = (stream: EventStream, data: AgentEvent['data']) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    this.handles.set(configId, { abort: abortController, configId });

    // Spawn Claude Agent SDK query in background
    const iter = query({
      prompt: taskPrompt,
      options: {
        abortController,
        systemPrompt,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
        permissionMode: 'bypassPermissions',
      },
    });

    // Process events in background
    (async () => {
      emit('lifecycle', { phase: 'start' });
      try {
        for await (const message of iter) {
          if (message.type === 'assistant') {
            emit('lifecycle', { phase: 'thinking' });
            for (const block of message.message.content) {
              if (block.type === 'text') {
                emit('assistant', { text: block.text });
              } else if (block.type === 'tool_use') {
                emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
              }
            }
          } else if (message.type === 'result') {
            emit('lifecycle', { phase: 'end' });
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit('error', { error: errorMsg });
        emit('lifecycle', { phase: 'end' });
      }
    })();

    const handle: AgentHandle = {
      id: `claude-${configId}-${Date.now()}`,
      configId,
      pid: null,
      stop: async () => {
        abortController.abort();
        this.handles.delete(configId);
      },
    };

    return handle;
  }

  async stop(handle: AgentHandle): Promise<void> {
    const entry = this.handles.get(handle.configId);
    if (entry) {
      entry.abort.abort();
      this.handles.delete(handle.configId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.handles) {
      entry.abort.abort();
    }
    this.handles.clear();
  }
}
```

- [ ] **Step 2: Create adapter barrel + factory**

```typescript
// apps/orchestrator/src/adapters/index.ts
export type { GatewayAdapter, AgentHandle, AgentEventCallback } from './adapter.js';
export { MockAdapter } from './mock-adapter.js';
export { ClaudeAdapter } from './claude-adapter.js';

import type { GatewayAdapter } from './adapter.js';
import { MockAdapter } from './mock-adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';

export function createAdapter(type: 'claude' | 'mock'): GatewayAdapter {
  switch (type) {
    case 'claude':
      return new ClaudeAdapter();
    case 'mock':
      return new MockAdapter();
  }
}
```

- [ ] **Step 3: Install claude-agent-sdk**

Run: `pnpm --filter @rigelhq/orchestrator add @anthropic-ai/claude-agent-sdk`

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/ apps/orchestrator/package.json pnpm-lock.yaml
git commit -m "feat: add Claude adapter and adapter factory"
```

---

### Task 5: Event bus

**Files:**
- Create: `apps/orchestrator/src/services/event-bus.ts`

- [ ] **Step 1: Implement event bus**

```typescript
// apps/orchestrator/src/services/event-bus.ts
import type Redis from 'ioredis';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';

export class EventBus {
  constructor(
    private publisher: Redis,
    private subscriber: Redis,
  ) {}

  /** Dual-write: publish to Pub/Sub + append to Stream */
  async publish(event: AgentEvent): Promise<void> {
    const payload = JSON.stringify(event);

    // Write to persistent Redis Stream
    await this.publisher.xadd(
      REDIS_STREAMS.EVENTS,
      '*',
      'data', payload,
    );

    // Also write to per-agent stream
    await this.publisher.xadd(
      REDIS_STREAMS.agentEvents(event.agentId),
      '*',
      'data', payload,
    );

    // Publish to Pub/Sub for real-time subscribers
    await this.publisher.publish(REDIS_CHANNELS.EVENTS, payload);
    await this.publisher.publish(REDIS_CHANNELS.agentEvents(event.agentId), payload);
  }

  /** Publish agent status update */
  async publishStatus(agentId: string, status: string): Promise<void> {
    await this.publisher.publish(
      REDIS_CHANNELS.agentStatus(agentId),
      JSON.stringify({ agentId, status, timestamp: Date.now() }),
    );
  }

  /** Subscribe to real-time events */
  async subscribe(
    channel: string,
    callback: (event: AgentEvent) => void,
  ): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(message));
        } catch {
          // Ignore non-JSON messages
        }
      }
    });
  }

  /** Read event history from Stream for replay on reconnect */
  async getHistory(
    streamKey: string,
    lastId: string = '0',
    count: number = 100,
  ): Promise<AgentEvent[]> {
    const results = await this.publisher.xrange(streamKey, lastId, '+', 'COUNT', count);
    return results.map(([, fields]) => {
      const dataIndex = fields.indexOf('data');
      return JSON.parse(fields[dataIndex + 1]) as AgentEvent;
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/services/event-bus.ts
git commit -m "feat: add EventBus with Redis Pub/Sub + Streams dual-write"
```

---

## Chunk 2: Agent Manager + Task Manager

### Task 6: Agent manager

**Files:**
- Create: `apps/orchestrator/src/services/agent-manager.ts`

- [ ] **Step 1: Implement agent manager**

```typescript
// apps/orchestrator/src/services/agent-manager.ts
import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';

interface ActiveAgent {
  handle: AgentHandle;
  configId: string;
  status: AgentStatus;
  lastActivity: number;
}

export class AgentManager {
  private active = new Map<string, ActiveAgent>();
  private queue: Array<{
    configId: string;
    systemPrompt: string;
    taskPrompt: string;
    resolve: (handle: AgentHandle) => void;
    reject: (err: Error) => void;
  }> = [];
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private adapter: GatewayAdapter,
    private eventBus: EventBus,
    private db: PrismaClient,
    private maxConcurrent: number = 5,
    private idleTimeoutMs: number = 5 * 60 * 1000, // 5 minutes
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  getActiveAgents(): ActiveAgent[] {
    return [...this.active.values()];
  }

  async spawnAgent(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
  ): Promise<AgentHandle> {
    // Check if already active
    if (this.active.has(configId)) {
      return this.active.get(configId)!.handle;
    }

    // Check pool capacity
    if (this.active.size >= this.maxConcurrent) {
      return new Promise((resolve, reject) => {
        this.queue.push({ configId, systemPrompt, taskPrompt, resolve, reject });
      });
    }

    return this.doSpawn(configId, systemPrompt, taskPrompt);
  }

  private async doSpawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
  ): Promise<AgentHandle> {
    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(configId, event);
    };

    const handle = await this.adapter.spawn(configId, systemPrompt, taskPrompt, onEvent);

    const activeAgent: ActiveAgent = {
      handle,
      configId,
      status: 'THINKING',
      lastActivity: Date.now(),
    };

    this.active.set(configId, activeAgent);

    // Update DB
    await this.db.agent.upsert({
      where: { configId },
      update: { status: 'THINKING', startedAt: new Date(), pid: handle.pid },
      create: {
        configId,
        name: configId,
        role: configId,
        icon: '🤖',
        status: 'THINKING',
        startedAt: new Date(),
        pid: handle.pid,
      },
    });

    await this.eventBus.publishStatus(configId, 'THINKING');

    return handle;
  }

  private async handleEvent(configId: string, event: AgentEvent): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent) return;

    agent.lastActivity = Date.now();

    // Map event to status
    const newStatus = this.mapEventToStatus(event);
    if (newStatus && newStatus !== agent.status) {
      agent.status = newStatus;
      await this.db.agent.update({
        where: { configId },
        data: { status: newStatus },
      });
      await this.eventBus.publishStatus(configId, newStatus);
    }

    // Publish event
    await this.eventBus.publish(event);

    // Handle lifecycle end
    if (event.stream === 'lifecycle' && event.data.phase === 'end') {
      await this.onAgentComplete(configId);
    }

    // Reset idle timer
    this.resetIdleTimer(configId);
  }

  private mapEventToStatus(event: AgentEvent): AgentStatus | null {
    switch (event.stream) {
      case 'lifecycle':
        if (event.data.phase === 'start' || event.data.phase === 'thinking') return 'THINKING';
        if (event.data.phase === 'end') return 'IDLE';
        return null;
      case 'tool':
        return event.data.phase === 'start' ? 'TOOL_CALLING' : 'THINKING';
      case 'assistant':
        return 'SPEAKING';
      case 'error':
        return 'ERROR';
      default:
        return null;
    }
  }

  private async onAgentComplete(configId: string): Promise<void> {
    this.clearIdleTimer(configId);
    this.active.delete(configId);

    await this.db.agent.update({
      where: { configId },
      data: { status: 'IDLE', pid: null },
    });

    // Process queue
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.active.size >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    try {
      const handle = await this.doSpawn(next.configId, next.systemPrompt, next.taskPrompt);
      next.resolve(handle);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private resetIdleTimer(configId: string): void {
    this.clearIdleTimer(configId);
    this.idleTimers.set(configId, setTimeout(() => {
      this.stopAgent(configId).catch(console.error);
    }, this.idleTimeoutMs));
  }

  private clearIdleTimer(configId: string): void {
    const timer = this.idleTimers.get(configId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(configId);
    }
  }

  async stopAgent(configId: string): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent) return;

    this.clearIdleTimer(configId);
    await this.adapter.stop(agent.handle);
    this.active.delete(configId);

    await this.db.agent.update({
      where: { configId },
      data: { status: 'OFFLINE', pid: null },
    });

    await this.eventBus.publishStatus(configId, 'OFFLINE');
    await this.processQueue();
  }

  async stopAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    await this.adapter.stopAll();

    for (const [configId] of this.active) {
      await this.db.agent.update({
        where: { configId },
        data: { status: 'OFFLINE', pid: null },
      }).catch(() => {}); // Best effort on shutdown
    }

    this.active.clear();
    this.queue = [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/services/agent-manager.ts
git commit -m "feat: add AgentManager with process pool and lifecycle"
```

---

### Task 7: Task manager

**Files:**
- Create: `apps/orchestrator/src/services/task-manager.ts`

- [ ] **Step 1: Implement task manager**

```typescript
// apps/orchestrator/src/services/task-manager.ts
import type { PrismaClient } from '@prisma/client';
import type { TaskStatus, TaskPriority } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';
import { REDIS_CHANNELS } from '@rigelhq/shared';

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  createdById: string;
  assignedAgentId?: string;
  parentTaskId?: string;
  projectId?: string;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['IN_REVIEW', 'FAILED', 'CANCELLED'],
  IN_REVIEW: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['PENDING'], // Allow retry
  CANCELLED: [],
};

export class TaskManager {
  constructor(
    private db: PrismaClient,
    private eventBus: EventBus,
  ) {}

  async createTask(input: CreateTaskInput) {
    const task = await this.db.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'MEDIUM',
        createdById: input.createdById,
        assignedAgentId: input.assignedAgentId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        projectId: input.projectId ?? null,
        status: 'PENDING',
      },
    });

    await this.publishTaskUpdate(task.id, 'PENDING');
    return task;
  }

  async updateStatus(taskId: string, newStatus: TaskStatus) {
    const task = await this.db.task.findUniqueOrThrow({ where: { id: taskId } });
    const currentStatus = task.status as string;

    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
    }

    const data: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'IN_PROGRESS') data.startedAt = new Date();
    if (newStatus === 'COMPLETED' || newStatus === 'FAILED') data.completedAt = new Date();

    const updated = await this.db.task.update({ where: { id: taskId }, data });
    await this.publishTaskUpdate(taskId, newStatus);
    return updated;
  }

  async setResult(taskId: string, result: Record<string, unknown>) {
    return this.db.task.update({
      where: { id: taskId },
      data: { result },
    });
  }

  async getTask(taskId: string) {
    return this.db.task.findUnique({ where: { id: taskId } });
  }

  async getTasksByAgent(agentId: string) {
    return this.db.task.findMany({
      where: { assignedAgentId: agentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveTasks() {
    return this.db.task.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async publishTaskUpdate(taskId: string, status: TaskStatus): Promise<void> {
    await this.eventBus.publish({
      id: `task-${taskId}-${Date.now()}`,
      agentId: 'system',
      runId: 'system',
      seq: 0,
      stream: 'lifecycle',
      timestamp: Date.now(),
      data: { taskId, status },
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/services/task-manager.ts
git commit -m "feat: add TaskManager with state machine and CRUD"
```

---

## Chunk 3: WebSocket + CEA + Wiring

### Task 8: WebSocket server

**Files:**
- Create: `apps/orchestrator/src/services/websocket-server.ts`

- [ ] **Step 1: Implement Socket.io server**

```typescript
// apps/orchestrator/src/services/websocket-server.ts
import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';

export class WebSocketServer {
  private io: SocketServer;

  constructor(
    httpServer: HttpServer,
    private eventBus: EventBus,
  ) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: ['http://localhost:3000'],
        methods: ['GET', 'POST'],
      },
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.io.on('connection', async (socket) => {
      console.log(`[WS] Client connected: ${socket.id}`);

      // Send recent event history on connect
      try {
        const history = await this.eventBus.getHistory(REDIS_STREAMS.EVENTS, '0', 50);
        socket.emit('event:history', history);
      } catch {
        // Redis might not have stream yet
      }

      // Handle user chat messages
      socket.on('chat:message', (data: { content: string; conversationId?: string }) => {
        this.io.emit('chat:user-message', data);
      });

      socket.on('disconnect', () => {
        console.log(`[WS] Client disconnected: ${socket.id}`);
      });
    });

    // Subscribe to Redis events and relay to all connected clients
    this.eventBus.subscribe(REDIS_CHANNELS.EVENTS, (event: AgentEvent) => {
      this.io.emit('agent:event', event);
    });
  }

  /** Broadcast an event to all connected clients */
  broadcast(eventName: string, data: unknown): void {
    this.io.emit(eventName, data);
  }

  /** Get count of connected clients */
  get clientCount(): number {
    return this.io.engine.clientsCount;
  }

  close(): void {
    this.io.close();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/services/websocket-server.ts
git commit -m "feat: add WebSocket server with event relay and history"
```

---

### Task 9: CEA manager

**Files:**
- Create: `apps/orchestrator/src/services/cea-manager.ts`

- [ ] **Step 1: Implement CEA manager**

```typescript
// apps/orchestrator/src/services/cea-manager.ts
import type { AgentManager } from './agent-manager.js';
import type { TaskManager, CreateTaskInput } from './task-manager.js';
import type { EventBus } from './event-bus.js';
import type { AgentHandle } from '../adapters/adapter.js';
import { AGENT_ROLES } from '@rigelhq/shared';

const CEA_CONFIG_ID = 'cea';

const CEA_SYSTEM_PROMPT = `You are the Chief Executive Agent (CEA) of RigelHQ, an AI-powered command center.
You orchestrate a team of 21 specialist agents. When a user gives you a task:
1. Analyze the request and break it into subtasks
2. Delegate to the appropriate specialist agent(s) using the Agent tool
3. Always prefix Agent tool prompts with the agent config ID in brackets, e.g., [backend-engineer] Build the REST API...
4. Review agent outputs before reporting back to the user
5. Coordinate between agents when tasks require collaboration

Available agents:
${AGENT_ROLES.map(r => `- [${r.id}] ${r.name} (${r.role})`).join('\n')}
`;

export class CEAManager {
  private handle: AgentHandle | null = null;
  private messageQueue: string[] = [];
  private healthy = false;

  constructor(
    private agentManager: AgentManager,
    private taskManager: TaskManager,
    private eventBus: EventBus,
  ) {}

  get isHealthy(): boolean {
    return this.healthy;
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  async start(): Promise<void> {
    console.log('[CEA] Starting Chief Executive Agent...');

    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      'You are now active. Acknowledge and wait for user instructions.',
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
    if (!this.healthy || !this.handle) {
      console.log('[CEA] Not healthy, queueing message');
      this.messageQueue.push(content);
      return;
    }

    // For the mock adapter, spawn a new "CEA run" for each message
    // The real Claude adapter would use session resumption
    await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      content,
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/services/cea-manager.ts
git commit -m "feat: add CEAManager with health monitoring and message queue"
```

---

### Task 10: Wire everything in index.ts

**Files:**
- Modify: `apps/orchestrator/src/index.ts`

- [ ] **Step 1: Update index.ts**

Replace the entire file with the fully wired orchestrator:

```typescript
// apps/orchestrator/src/index.ts
import http from 'http';
import { loadConfig } from './config.js';
import { getDb, disconnectDb } from './services/db-service.js';
import { getRedisPublisher, getRedisSubscriber, disconnectRedis } from './services/redis-service.js';
import { EventBus } from './services/event-bus.js';
import { AgentManager } from './services/agent-manager.js';
import { TaskManager } from './services/task-manager.js';
import { CEAManager } from './services/cea-manager.js';
import { WebSocketServer } from './services/websocket-server.js';
import { createAdapter } from './adapters/index.js';

async function main() {
  const config = loadConfig();
  console.log('[RigelHQ Orchestrator] Starting...');
  console.log(`[RigelHQ Orchestrator] Adapter: ${config.RIGELHQ_ADAPTER}`);
  console.log(`[RigelHQ Orchestrator] Max concurrent agents: ${config.RIGELHQ_MAX_CONCURRENT_AGENTS}`);

  // Initialize core services
  const db = getDb();
  const redisPub = getRedisPublisher(config.REDIS_URL);
  const redisSub = getRedisSubscriber(config.REDIS_URL);

  // Verify connections
  await db.$queryRaw`SELECT 1`;
  console.log('[RigelHQ Orchestrator] PostgreSQL connected');

  await redisPub.ping();
  console.log('[RigelHQ Orchestrator] Redis connected');

  // Build service graph
  const eventBus = new EventBus(redisPub, redisSub);
  const adapter = createAdapter(config.RIGELHQ_ADAPTER);
  const agentManager = new AgentManager(adapter, eventBus, db, config.RIGELHQ_MAX_CONCURRENT_AGENTS);
  const taskManager = new TaskManager(db, eventBus);
  const ceaManager = new CEAManager(agentManager, taskManager, eventBus);

  // HTTP + WebSocket server
  const httpServer = http.createServer();
  const wsServer = new WebSocketServer(httpServer, eventBus);

  httpServer.listen(config.RIGELHQ_ORCHESTRATOR_PORT, () => {
    console.log(`[RigelHQ Orchestrator] WebSocket server on port ${config.RIGELHQ_ORCHESTRATOR_PORT}`);
  });

  // Start CEA
  await ceaManager.start();

  console.log('[RigelHQ Orchestrator] Ready');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[RigelHQ Orchestrator] Shutting down...');

    // 1. Stop accepting connections
    wsServer.close();

    // 2. Stop all agents (30s grace period)
    const shutdownTimeout = setTimeout(() => {
      console.log('[RigelHQ Orchestrator] Force shutdown after timeout');
      process.exit(1);
    }, 30_000);

    await ceaManager.stop();
    await agentManager.stopAll();

    // 3. Close connections
    await disconnectRedis();
    await disconnectDb();

    clearTimeout(shutdownTimeout);
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[RigelHQ Orchestrator] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rigelhq/orchestrator typecheck`

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @rigelhq/orchestrator test`

- [ ] **Step 4: Commit**

```bash
git add apps/orchestrator/src/
git commit -m "feat: wire orchestrator with adapter, event bus, agents, WebSocket, and CEA"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```
