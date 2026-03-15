'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { AgentStatus, AgentEvent } from '@rigelhq/shared';
import { AGENT_ROLES } from '@rigelhq/shared';
import {
  calculateMeetingPoint,
  calculateGroupMeetingPositions,
} from '@/components/office/walking-path';

enableMapSet();

// Zone layout positions for 1200x700 office floor
const ZONE_POSITIONS: Record<string, { baseX: number; baseY: number }> = {
  'ceo-suite': { baseX: 600, baseY: -40 },
  executive: { baseX: 130, baseY: 130 },
  engineering: { baseX: 700, baseY: 130 },
  quality: { baseX: 130, baseY: 470 },
  ops: { baseX: 700, baseY: 470 },
};

// ── Collaboration color palette (8 colors, cycle through) ───
const COLLAB_COLORS = [
  '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6',
  '#84cc16', '#06b6d4', '#ec4899', '#10b981',
] as const;

let colorIndex = 0;
function nextCollabColor(): string {
  const color = COLLAB_COLORS[colorIndex % COLLAB_COLORS.length];
  colorIndex++;
  return color;
}

// ── Types ────────────────────────────────────────────────────

export interface AgentState {
  configId: string;
  name: string;
  icon: string;
  role: string;
  zone: string;
  status: AgentStatus;
  mvpActive: boolean;
  position: { x: number; y: number };
  homePosition: { x: number; y: number };
  currentTool: string | null;
  speechBubble: string | null;
  speechTimeout: ReturnType<typeof setTimeout> | null;
  collaborationId: string | null;
}

export interface ActiveCollaboration {
  id: string;
  type: 'parallel' | 'consultation' | 'meeting';
  participants: string[];
  topic: string;
  color: string;
  activeSpeaker: string | null;
  startedAt: number;
  status: 'active' | 'fading';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  content: string;
  timestamp: number;
}

/**
 * Shape of a collaboration event's data payload.
 * These are local types that mirror what the backend will emit;
 * import from @rigelhq/shared once that package ships the types.
 */
interface CollaborationEventData {
  phase: 'start' | 'message' | 'end';
  collaborationId: string;
  type?: 'parallel' | 'consultation' | 'meeting';
  participants?: string[];
  topic?: string;
  initiatedBy?: string;
  fromAgent?: string;
  toAgent?: string;
  preview?: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface MovementEventData {
  phase: 'start' | 'waypoint' | 'arrived';
  fromX?: number;
  fromY?: number;
  toX: number;
  toY: number;
  reason: 'collaboration' | 'return_to_desk' | 'meeting';
  collaborationId?: string;
  [key: string]: unknown;
}

interface AgentStore {
  agents: Map<string, AgentState>;
  collaborations: Map<string, ActiveCollaboration>;
  messages: ChatMessage[];
  events: AgentEvent[];
  connected: boolean;

  // Actions
  initAgents: () => void;
  handleEvent: (event: AgentEvent) => void;
  handleCollaborationEvent: (event: AgentEvent) => void;
  handleMovementEvent: (event: AgentEvent) => void;
  handleCollaborationSnapshot: (collabs: ActiveCollaboration[]) => void;
  setConnected: (connected: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  addEvent: (event: AgentEvent) => void;
  updateAgentStatus: (configId: string, status: AgentStatus) => void;
}

export const useAgentStore = create<AgentStore>()(
  immer((set) => ({
    agents: new Map(),
    collaborations: new Map(),
    messages: [],
    events: [],
    connected: false,

    initAgents: () => {
      set((state) => {
        const zoneCounters: Record<string, number> = {};

        for (const role of AGENT_ROLES) {
          const zone = role.zone;
          zoneCounters[zone] = (zoneCounters[zone] ?? 0) + 1;
          const idx = zoneCounters[zone];
          const base = ZONE_POSITIONS[zone] ?? { baseX: 300, baseY: 300 };

          // Grid layout within zone: 3 columns, desk spacing
          const col = (idx - 1) % 3;
          const row = Math.floor((idx - 1) / 3);
          const pos = {
            x: base.baseX + col * 180,
            y: base.baseY + row * 120,
          };

          state.agents.set(role.id, {
            configId: role.id,
            name: role.name,
            icon: role.icon,
            role: role.role,
            zone,
            status: 'OFFLINE',
            mvpActive: role.mvpActive,
            position: { ...pos },
            homePosition: { ...pos },
            currentTool: null,
            speechBubble: null,
            speechTimeout: null,
            collaborationId: null,
          });
        }
      });
    },

    handleEvent: (event: AgentEvent) => {
      set((state) => {
        // Push to activity feed (keep last 100)
        state.events.push(event);
        if (state.events.length > 100) {
          state.events = state.events.slice(-100);
        }

        const agent = state.agents.get(event.agentId);
        if (!agent) return;

        switch (event.stream) {
          case 'lifecycle':
            if (event.data.phase === 'start' || event.data.phase === 'thinking') {
              agent.status = 'THINKING';
              agent.currentTool = null;
              agent.speechBubble = null;
            } else if (event.data.phase === 'end') {
              agent.status = 'IDLE';
              agent.currentTool = null;
              agent.speechBubble = null;
            }
            break;

          case 'tool':
            if (event.data.phase === 'start') {
              agent.status = 'TOOL_CALLING';
              agent.currentTool = (event.data.tool as string) ?? null;
            } else {
              agent.status = 'THINKING';
              agent.currentTool = null;
            }
            break;

          case 'assistant':
            agent.status = 'SPEAKING';
            agent.speechBubble = ((event.data.text as string) ?? '').slice(0, 80);
            break;

          case 'error':
            agent.status = 'ERROR';
            agent.speechBubble = (event.data.error as string) ?? 'Error';
            break;
        }
      });
    },

    // ── Collaboration event handler ───────────────────────────
    handleCollaborationEvent: (event: AgentEvent) => {
      const data = event.data as unknown as CollaborationEventData;

      set((state) => {
        switch (data.phase) {
          case 'start': {
            const participants = data.participants ?? [];
            const collab: ActiveCollaboration = {
              id: data.collaborationId,
              type: data.type ?? 'parallel',
              participants,
              topic: (data.topic as string) ?? '',
              color: nextCollabColor(),
              activeSpeaker: null,
              startedAt: event.timestamp,
              status: 'active',
            };

            state.collaborations.set(collab.id, collab);

            // Mark agents as part of this collaboration
            for (const pid of participants) {
              const a = state.agents.get(pid);
              if (a) {
                a.collaborationId = collab.id;
              }
            }

            // Move agents to meeting points
            if (participants.length >= 3) {
              const positions = calculateGroupMeetingPositions(participants);
              for (const [agentId, pos] of positions) {
                const a = state.agents.get(agentId);
                if (a) {
                  a.position = { x: pos.x, y: pos.y };
                }
              }
            } else if (participants.length === 2) {
              const agentA = state.agents.get(participants[0]);
              const agentB = state.agents.get(participants[1]);
              if (agentA && agentB) {
                // Use home positions for the meeting point calculation
                const { pointA, pointB } = calculateMeetingPoint(
                  { position: agentA.homePosition, zone: agentA.zone },
                  { position: agentB.homePosition, zone: agentB.zone },
                );
                agentA.position = { x: pointA.x, y: pointA.y };
                agentB.position = { x: pointB.x, y: pointB.y };
              }
            }
            break;
          }

          case 'message': {
            const collab = state.collaborations.get(data.collaborationId);
            if (collab) {
              collab.activeSpeaker = data.fromAgent ?? event.agentId;
            }
            break;
          }

          case 'end': {
            const collab = state.collaborations.get(data.collaborationId);
            if (!collab) break;

            // Transition to fading state — the component will
            // animate the fade, then we remove after 600ms.
            collab.status = 'fading';

            // Return agents to home positions and clear collaboration link
            for (const pid of collab.participants) {
              const a = state.agents.get(pid);
              if (a) {
                a.position = { x: a.homePosition.x, y: a.homePosition.y };
                a.collaborationId = null;
              }
            }

            // Schedule removal (done outside immer for the timeout)
            break;
          }
        }
      });

      // Handle deferred removal for fading collaborations
      if (data.phase === 'end') {
        setTimeout(() => {
          set((state) => {
            state.collaborations.delete(data.collaborationId);
          });
        }, 600);
      }
    },

    // ── Movement event handler ────────────────────────────────
    handleMovementEvent: (event: AgentEvent) => {
      const data = event.data as unknown as MovementEventData;

      set((state) => {
        const agent = state.agents.get(event.agentId);
        if (!agent) return;

        agent.position = { x: data.toX, y: data.toY };
      });
    },

    // ── Snapshot handler for page refresh mid-collaboration ──
    handleCollaborationSnapshot: (collabs: ActiveCollaboration[]) => {
      set((state) => {
        for (const collab of collabs) {
          state.collaborations.set(collab.id, collab);
          for (const pid of collab.participants) {
            const a = state.agents.get(pid);
            if (a) {
              a.collaborationId = collab.id;
            }
          }
        }
      });
    },

    setConnected: (connected) => {
      set((state) => {
        state.connected = connected;
      });
    },

    addMessage: (message) => {
      set((state) => {
        state.messages.push(message);
        // Keep last 200 messages
        if (state.messages.length > 200) {
          state.messages = state.messages.slice(-200);
        }
      });
    },

    addEvent: (event) => {
      set((state) => {
        state.events.push(event);
        if (state.events.length > 100) {
          state.events = state.events.slice(-100);
        }
      });
    },

    updateAgentStatus: (configId, status) => {
      set((state) => {
        const agent = state.agents.get(configId);
        if (agent) agent.status = status;
      });
    },
  })),
);
