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
    private idleTimeoutMs: number = 5 * 60 * 1000,
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
