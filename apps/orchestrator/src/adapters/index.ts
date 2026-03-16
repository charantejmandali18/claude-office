export type { GatewayAdapter, SessionHandle, AgentEventCallback, SessionOptions, SessionInfo } from './adapter.js';
export { ClaudeAdapter } from './claude-adapter.js';

import type { GatewayAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';

export function createAdapter(): GatewayAdapter {
  return new ClaudeAdapter();
}
