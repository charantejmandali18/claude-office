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

  it('stops an agent and emits end event', async () => {
    adapter = new MockAdapter();
    const events: AgentEvent[] = [];
    const handle = await adapter.spawn('frontend-engineer', 'prompt', 'task', (e) => events.push(e));

    await handle.stop();

    const lastEvent = events[events.length - 1];
    expect(lastEvent.stream).toBe('lifecycle');
    expect(lastEvent.data.phase).toBe('end');
  });

  it('emits full event sequence over time', async () => {
    adapter = new MockAdapter();
    const events: AgentEvent[] = [];
    await adapter.spawn('qa-tester', 'prompt', 'task', (e) => events.push(e));

    // Wait for the full sequence (4s + buffer)
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(5), { timeout: 6000 });

    const streams = events.map(e => e.stream);
    expect(streams[0]).toBe('lifecycle'); // start
    expect(streams).toContain('tool');
    expect(streams).toContain('assistant');
  });

  it('stopAll clears all agents', async () => {
    adapter = new MockAdapter();
    await adapter.spawn('agent-1', 'p', 't', () => {});
    await adapter.spawn('agent-2', 'p', 't', () => {});

    await adapter.stopAll();
    // No error means success
  });
});
