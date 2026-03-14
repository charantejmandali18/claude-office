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
