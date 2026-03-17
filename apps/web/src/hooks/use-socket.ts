'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAgentStore } from '@/store/agent-store';
import type { AgentEvent, AgentStatus } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { ActiveCollaboration } from '@/store/agent-store';

const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const {
    handleEvent,
    handleCollaborationEvent,
    handleMovementEvent,
    handleCollaborationSnapshot,
    setConnected,
    addMessage,
    initAgents,
    updateAgentStatus,
    createSessionState,
    switchSession,
    handleSessionEvent,
    addBabyAgent,
    removeBabyAgent,
  } = useAgentStore();

  useEffect(() => {
    // Initialize agent positions on mount
    initAgents();

    const socket = io(ORCHESTRATOR_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected to orchestrator');
      setConnected(true);
      addMessage({
        id: `sys-${Date.now()}`,
        sender: 'system',
        content: 'Connected to RigelHQ Orchestrator',
        timestamp: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected from orchestrator');
      setConnected(false);
      addMessage({
        id: `sys-${Date.now()}`,
        sender: 'system',
        content: 'Disconnected from orchestrator \u2014 reconnecting...',
        timestamp: Date.now(),
      });
    });

    // Receive event history on connect
    socket.on('event:history', (events: AgentEvent[]) => {
      for (const event of events) {
        handleEvent(event);
      }
    });

    // Receive current agent statuses from DB (ensures UI is correct even if events have rotated out)
    socket.on('agent:status-snapshot', (agents: Array<{ configId: string; status: string }>) => {
      for (const { configId, status } of agents) {
        updateAgentStatus(configId, status as AgentStatus);
      }
    });

    // Receive active collaboration snapshot on connect (for page refresh mid-collaboration)
    socket.on('collaboration:snapshot', (collabs: ActiveCollaboration[]) => {
      handleCollaborationSnapshot(collabs);
    });

    // Real-time agent events
    socket.on('agent:event', (event: AgentEvent) => {
      // Route collaboration events to the dedicated handler
      if (event.stream === 'collaboration' as string) {
        handleCollaborationEvent(event);
        return;
      }

      // Route movement events to the dedicated handler
      if (event.stream === 'movement' as string) {
        handleMovementEvent(event);
        return;
      }

      // Default: standard event handling
      handleEvent(event);

      // Add assistant text to chat
      if (event.stream === 'assistant' && event.data.text) {
        const roleMeta = AGENT_ROLE_MAP.get(event.agentId);
        addMessage({
          id: event.id,
          sender: 'agent',
          agentId: event.agentId,
          agentName: roleMeta?.name ?? event.agentId,
          content: event.data.text as string,
          timestamp: event.timestamp,
        });
      }
    });

    // ── Session events ──────────────────────────────────────
    socket.on('session:list', (sessions: Array<{ sessionId: string; projectName: string; status: string }>) => {
      for (const s of sessions) {
        createSessionState(s.sessionId, s.projectName);
        if (s.status === 'stopped') {
          handleSessionEvent({ type: 'stopped', sessionId: s.sessionId });
        }
      }
    });

    socket.on('session:created', (data: { sessionId: string; projectName: string }) => {
      handleSessionEvent({ type: 'created', sessionId: data.sessionId, projectName: data.projectName });
    });

    socket.on('session:switched', (data: { sessionId: string }) => {
      handleSessionEvent({ type: 'switched', sessionId: data.sessionId });
    });

    socket.on('session:stopped', (data: { sessionId: string }) => {
      handleSessionEvent({ type: 'stopped', sessionId: data.sessionId });
    });

    // ── Baby agent events ─────────────────────────────────
    socket.on('baby-agent:spawn', (data: { taskId: string; parentAgentId: string; type: string }) => {
      addBabyAgent(data.taskId, data.parentAgentId, data.type);
    });

    socket.on('baby-agent:remove', (data: { taskId: string }) => {
      removeBabyAgent(data.taskId);
    });

    // ── Chat stream (team lead output) ────────────────────
    socket.on('chat:stream', (data: { text: string; agentId?: string; agentName?: string }) => {
      addMessage({
        id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sender: 'agent',
        agentId: data.agentId,
        agentName: data.agentName,
        content: data.text,
        timestamp: Date.now(),
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = (content: string, targetAgent?: string) => {
    if (socketRef.current?.connected) {
      const activeSessionId = useAgentStore.getState().activeSessionId;
      socketRef.current.emit('chat:message', {
        content,
        targetAgent,
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
      });
      addMessage({
        id: `user-${Date.now()}`,
        sender: 'user',
        content,
        timestamp: Date.now(),
      });
    }
  };

  /** Ask the orchestrator's summarizer subagent to summarize text for TTS */
  const summarize = (text: string): Promise<string> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected || !text || text.length <= 120) {
        resolve(text ?? '');
        return;
      }
      // Use Socket.io acknowledgment callback for request/response
      socketRef.current.emit(
        'voice:summarize',
        { text },
        (resp: { summary: string }) => {
          resolve(resp?.summary ?? text);
        },
      );
      // Timeout fallback — don't hang if orchestrator doesn't respond
      setTimeout(() => resolve(text.slice(0, 200)), 5000);
    });
  };

  /** Open a terminal window attached to an agent's Claude Code session */
  const openTerminal = (configId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('session:open-terminal', { configId });
    }
  };

  return { sendMessage, summarize, openTerminal };
}
