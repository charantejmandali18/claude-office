import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';
import type { SessionGateway } from './session-gateway.js';
import type { PrismaClient } from '@prisma/client';

export class WebSocketServer {
  private io: SocketServer;
  private sessionGateway: SessionGateway | null = null;
  private db: PrismaClient | null = null;

  constructor(
    httpServer: HttpServer,
    private eventBus: EventBus,
  ) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST'],
      },
    });

    this.setupHandlers();
  }

  /** Attach session gateway for routing chat messages */
  setSessionGateway(sg: SessionGateway): void {
    this.sessionGateway = sg;
  }

  /** Attach DB for sending agent status snapshots on connect */
  setDb(db: PrismaClient): void {
    this.db = db;
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

      // Send current agent statuses from DB so the UI is immediately up-to-date
      if (this.db) {
        try {
          const agents = await this.db.agent.findMany({
            select: { configId: true, status: true },
          });
          socket.emit('agent:status-snapshot', agents);
        } catch {
          // Best effort
        }
      }

      // Send active session list on connect
      if (this.sessionGateway) {
        try {
          const sessions = await this.sessionGateway.listSessions();
          socket.emit('session:list', sessions);
        } catch {
          // Best effort
        }
      }

      // Handle user chat messages — route to SessionGateway
      socket.on('chat:message', async (data: {
        content: string;
        sessionId?: string;
        projectName?: string;
        targetAgent?: string;
      }) => {
        console.log(`[WS] Chat message (session: ${data.sessionId ?? 'new'}, project: ${data.projectName ?? 'default'}): ${data.content.slice(0, 80)}`);

        // Broadcast user message to all clients immediately
        this.io.emit('chat:user-message', data);

        if (!this.sessionGateway) {
          socket.emit('chat:error', { message: 'Session gateway not available' });
          return;
        }

        try {
          if (data.sessionId) {
            // Send to existing session
            await this.sessionGateway.sendMessage(data.sessionId, data.content);
          } else {
            // Create a new session
            const projectName = data.projectName ?? 'default';
            await this.sessionGateway.createSession(projectName, data.content);
          }
        } catch (err) {
          console.error('[WS] Error routing message:', err);
          socket.emit('chat:error', { message: 'Failed to process message' });
        }
      });

      // Session management events
      socket.on('session:create', async (data: { projectName: string; message?: string }) => {
        if (!this.sessionGateway) {
          socket.emit('chat:error', { message: 'Session gateway not available' });
          return;
        }
        try {
          const sessionId = await this.sessionGateway.createSession(data.projectName, data.message ?? 'Hello');
          socket.emit('session:created', { sessionId, projectName: data.projectName });
        } catch (err) {
          console.error('[WS] Error creating session:', err);
          socket.emit('chat:error', { message: 'Failed to create session' });
        }
      });

      socket.on('session:switch', async (data: { sessionId: string }) => {
        if (!this.sessionGateway) {
          socket.emit('chat:error', { message: 'Session gateway not available' });
          return;
        }
        try {
          if (this.sessionGateway.hasSession(data.sessionId)) {
            socket.emit('session:switched', { sessionId: data.sessionId });
          } else {
            socket.emit('chat:error', { message: `Session ${data.sessionId} not found` });
          }
        } catch (err) {
          console.error('[WS] Error switching session:', err);
          socket.emit('chat:error', { message: 'Failed to switch session' });
        }
      });

      socket.on('session:stop', async (data: { sessionId: string }) => {
        if (!this.sessionGateway) {
          socket.emit('chat:error', { message: 'Session gateway not available' });
          return;
        }
        try {
          await this.sessionGateway.stopSession(data.sessionId);
          socket.emit('session:stopped', { sessionId: data.sessionId });
        } catch (err) {
          console.error('[WS] Error stopping session:', err);
          socket.emit('chat:error', { message: `Failed to stop session ${data.sessionId}` });
        }
      });

      socket.on('session:list', async () => {
        if (!this.sessionGateway) {
          socket.emit('session:list', []);
          return;
        }
        const sessions = await this.sessionGateway.listSessions();
        socket.emit('session:list', sessions);
      });

      // Open a terminal window attached to a Claude session
      socket.on('session:open-terminal', async (data: { sessionId: string; cwd?: string }) => {
        if (!data.sessionId) {
          socket.emit('chat:error', { message: 'No session ID provided' });
          return;
        }

        console.log(`[WS] Opening terminal for session ${data.sessionId.slice(0, 8)}...`);

        try {
          const { execFile } = await import('child_process');
          const { writeFileSync, unlinkSync } = await import('fs');
          const { tmpdir } = await import('os');
          const path = await import('path');

          const cdCmd = data.cwd ? `cd ${data.cwd.replace(/"/g, '\\"')} && ` : '';
          const cmd = `${cdCmd}claude --resume ${data.sessionId}`;
          const scriptPath = path.join(tmpdir(), `rigel-terminal-${Date.now()}.scpt`);

          const script = [
            'tell application "Terminal"',
            '  activate',
            `  do script "${cmd}"`,
            'end tell',
          ].join('\n');

          writeFileSync(scriptPath, script);
          execFile('osascript', [scriptPath], (err) => {
            try { unlinkSync(scriptPath); } catch { /* cleanup best effort */ }
            if (err) {
              console.error('[WS] AppleScript failed:', err.message);
              socket.emit('chat:error', { message: 'Failed to open terminal — check macOS permissions for Terminal automation' });
            } else {
              console.log(`[WS] Terminal opened for session ${data.sessionId.slice(0, 8)}...`);
            }
          });
        } catch (err) {
          console.error('[WS] Error opening terminal:', err);
          socket.emit('chat:error', { message: 'Failed to open terminal' });
        }
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
