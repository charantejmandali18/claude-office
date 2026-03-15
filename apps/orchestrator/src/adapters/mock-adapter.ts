import type { AgentEvent } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback, SpawnOptions } from './adapter.js';

interface MockAgent {
  handle: AgentHandle;
  timers: ReturnType<typeof setTimeout>[];
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
    _options?: SpawnOptions,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const agent: MockAgent = {
      handle: {
        id: `mock-${configId}-${Date.now()}`,
        configId,
        pid: null,
        stop: async () => this.stopAgent(configId),
      },
      timers: [],
      stopped: false,
      callback: onEvent,
      runId,
      seq: 0,
    };

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

    // Simulate: thinking → tool_calling → speaking → end
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
      agent.timers.push(timer);
    }
  }

  private async stopAgent(configId: string): Promise<void> {
    const agent = this.agents.get(configId);
    if (!agent) return;

    for (const timer of agent.timers) clearTimeout(timer);
    agent.timers = [];

    // Emit end before marking stopped so emitEvent guard passes
    this.emitEvent(configId, 'lifecycle', { phase: 'end' });
    agent.stopped = true;
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
