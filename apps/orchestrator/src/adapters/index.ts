export type { GatewayAdapter, AgentHandle, AgentEventCallback, SpawnOptions, SubagentDef } from './adapter.js';
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
