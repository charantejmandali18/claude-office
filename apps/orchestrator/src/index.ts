import http from 'http';
import { loadConfig } from './config.js';
import { getDb, disconnectDb } from './services/db-service.js';
import { getRedisPublisher, getRedisSubscriber, disconnectRedis } from './services/redis-service.js';
import { EventBus } from './services/event-bus.js';
import { SessionGateway } from './services/session-gateway.js';
import { HookReceiver } from './services/hook-receiver.js';
import { FileWatcher } from './services/file-watcher.js';
import { WebSocketServer } from './services/websocket-server.js';
import { createAdapter } from './adapters/index.js';
import { AGENT_ROLES } from '@rigelhq/shared';
import type { PrismaClient } from '@prisma/client';

async function main() {
  const config = loadConfig();
  console.log('[RigelHQ] Starting Session Gateway...');

  // Initialize core services
  const db = getDb();
  const redisPub = getRedisPublisher(config.REDIS_URL);
  const redisSub = getRedisSubscriber(config.REDIS_URL);

  await db.$queryRaw`SELECT 1`;
  console.log('[RigelHQ] PostgreSQL connected');
  await redisPub.ping();
  console.log('[RigelHQ] Redis connected');

  // Build service graph
  const eventBus = new EventBus(redisPub, redisSub);
  const adapter = createAdapter();
  const sessionGateway = new SessionGateway(adapter, eventBus, db);
  const hookReceiver = new HookReceiver(eventBus);
  const fileWatcher = new FileWatcher(eventBus);

  // HTTP server handles both hooks (POST /hooks/event) and WebSocket upgrades
  const hookHandler = hookReceiver.handler();
  const httpServer = http.createServer((req, res) => {
    hookHandler(req, res);
  });

  const wsServer = new WebSocketServer(httpServer, eventBus);
  wsServer.setSessionGateway(sessionGateway);
  wsServer.setDb(db);

  // Seed agent metadata (for UI display)
  await seedAgentMetadata(db);

  httpServer.listen(config.RIGELHQ_ORCHESTRATOR_PORT, () => {
    console.log(`[RigelHQ] Session Gateway on port ${config.RIGELHQ_ORCHESTRATOR_PORT}`);
  });

  fileWatcher.start();
  console.log('[RigelHQ] Ready — awaiting user messages');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[RigelHQ] Shutting down...');
    fileWatcher.stop();
    wsServer.close();
    const timeout = setTimeout(() => process.exit(1), 30_000);
    await sessionGateway.stopAll();
    await disconnectRedis();
    await disconnectDb();
    clearTimeout(timeout);
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/** Seed all agent metadata in DB so UI can display them from boot */
async function seedAgentMetadata(db: PrismaClient) {
  // Reset all agents to OFFLINE on boot
  await db.agent.updateMany({
    data: { status: 'OFFLINE', sessionId: null, taskId: null },
  });

  // Upsert all MVP agents as IDLE
  const mvpAgents = AGENT_ROLES.filter(r => r.mvpActive);
  for (const role of mvpAgents) {
    await db.agent.upsert({
      where: { configId: role.id },
      update: { status: 'IDLE' },
      create: {
        configId: role.id,
        name: role.name,
        role: role.role,
        icon: role.icon,
        status: 'IDLE',
      },
    });
  }
  console.log(`[RigelHQ] ${mvpAgents.length} agents seeded`);
}

main().catch((err) => {
  console.error('[RigelHQ] Fatal error:', err);
  process.exit(1);
});
