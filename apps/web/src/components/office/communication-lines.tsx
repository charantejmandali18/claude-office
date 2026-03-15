'use client';

import { useMemo } from 'react';
import { useAgentStore } from '@/store/agent-store';
import type { ActiveCollaboration, AgentState } from '@/store/agent-store';

// Agent avatar radius (must match agent-avatar.tsx)
const AGENT_R = 26;

// ── Bezier path helpers ──────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Build a quadratic Bezier `d` attribute between two points.
 * The control point is offset perpendicular to the midpoint
 * by 15% of the segment length — this gives a smooth organic curve.
 */
function bezierPath(a: Point, b: Point, index = 0): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return `M ${a.x},${a.y} L ${b.x},${b.y}`;

  // Perpendicular direction
  const perpX = -dy / len;
  const perpY = dx / len;

  // Stagger multiple lines between the same agents so they do not overlap
  const offset = len * 0.15 * (index % 2 === 0 ? 1 : -1);

  const midX = (a.x + b.x) / 2 + perpX * offset;
  const midY = (a.y + b.y) / 2 + perpY * offset;

  return `M ${a.x},${a.y} Q ${midX},${midY} ${b.x},${b.y}`;
}

/**
 * Offset a point from the center of an agent toward a target so
 * the line starts/ends at the edge of the status ring, not the center.
 */
function edgePoint(center: Point, target: Point, radius: number): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return center;
  return {
    x: center.x + (dx / len) * radius,
    y: center.y + (dy / len) * radius,
  };
}

// ── Sub-components ───────────────────────────────────────────

/**
 * Animated particles that flow along a Bezier path.
 * Uses SVG <animateMotion> for buttery-smooth, GPU-friendly animation.
 */
function PathParticles({
  pathD,
  color,
  isFading,
}: {
  pathD: string;
  color: string;
  isFading: boolean;
}) {
  if (isFading) return null;

  const particles = [
    { delay: '0s', opacity: 1.0 },
    { delay: '0.6s', opacity: 0.7 },
    { delay: '1.2s', opacity: 0.4 },
  ];

  return (
    <g>
      {particles.map((p, i) => (
        <circle key={i} r={2.5} fill={color} opacity={p.opacity}>
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            begin={p.delay}
            path={pathD}
          />
        </circle>
      ))}
    </g>
  );
}

/**
 * A single communication line between two agents,
 * including the path stroke and animated particles.
 */
function CollaborationLine({
  from,
  to,
  color,
  status,
  index,
}: {
  from: Point;
  to: Point;
  color: string;
  status: 'active' | 'fading';
  index: number;
}) {
  const isFading = status === 'fading';

  // Offset endpoints to the edge of the agent's status ring
  const edgeFrom = edgePoint(from, to, AGENT_R + 2);
  const edgeTo = edgePoint(to, from, AGENT_R + 2);

  const d = bezierPath(edgeFrom, edgeTo, index);

  return (
    <g
      style={{
        opacity: isFading ? 0 : 0.7,
        transition: 'opacity 600ms ease-out',
      }}
    >
      {/* Main path */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isFading ? undefined : '8 4'}
        style={{
          filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.15))',
        }}
      >
        {/* Animated dash offset for flowing effect */}
        {!isFading && (
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-24"
            dur="0.8s"
            repeatCount="indefinite"
          />
        )}
      </path>

      {/* Particles following the path */}
      <PathParticles pathD={d} color={color} isFading={isFading} />
    </g>
  );
}

/**
 * For 3+ participants, render a translucent meeting zone circle
 * centered on the meeting table.
 */
function MeetingZone({
  participants,
  color,
  isFading,
}: {
  participants: number;
  color: string;
  isFading: boolean;
}) {
  const radius = 45 + Math.max(0, participants - 2) * 8;

  return (
    <circle
      cx={460}
      cy={230}
      r={radius}
      fill={color}
      opacity={isFading ? 0 : 0.08}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={isFading ? 0 : 0.2}
      style={{ transition: 'opacity 600ms ease-out, r 400ms ease-out' }}
    />
  );
}

// ── Main component ───────────────────────────────────────────

/**
 * CommunicationLines reads active collaborations from the Zustand store
 * and renders animated SVG paths + particles between collaborating agents.
 * It is placed as Layer 7.5 in the office SVG (between decorations and avatars).
 */
export function CommunicationLines() {
  const collaborations = useAgentStore((s) => s.collaborations);
  const agents = useAgentStore((s) => s.agents);

  // Build the list of lines to render
  const lines = useMemo(() => {
    const result: Array<{
      key: string;
      from: Point;
      to: Point;
      color: string;
      status: 'active' | 'fading';
      index: number;
    }> = [];

    let lineIndex = 0;

    collaborations.forEach((collab: ActiveCollaboration) => {
      const parts = collab.participants;

      if (parts.length === 2) {
        // Direct line between the two agents
        const a = agents.get(parts[0]) as AgentState | undefined;
        const b = agents.get(parts[1]) as AgentState | undefined;
        if (a && b) {
          result.push({
            key: `${collab.id}-${parts[0]}-${parts[1]}`,
            from: a.position,
            to: b.position,
            color: collab.status === 'fading' ? collab.color : collab.color,
            status: collab.status,
            index: lineIndex++,
          });
        }
      } else if (parts.length >= 3) {
        // Star topology: line from initiator (first participant) to each other
        const initiator = agents.get(parts[0]) as AgentState | undefined;
        if (!initiator) return;

        for (let i = 1; i < parts.length; i++) {
          const target = agents.get(parts[i]) as AgentState | undefined;
          if (!target) continue;
          result.push({
            key: `${collab.id}-${parts[0]}-${parts[i]}`,
            from: initiator.position,
            to: target.position,
            color: collab.color,
            status: collab.status,
            index: lineIndex++,
          });
        }
      }
    });

    return result;
  }, [collaborations, agents]);

  // Determine which collaborations have 3+ participants for meeting zones
  const meetingZones = useMemo(() => {
    const zones: Array<{
      key: string;
      participants: number;
      color: string;
      isFading: boolean;
    }> = [];

    collaborations.forEach((collab: ActiveCollaboration) => {
      if (collab.participants.length >= 3) {
        zones.push({
          key: `zone-${collab.id}`,
          participants: collab.participants.length,
          color: collab.color,
          isFading: collab.status === 'fading',
        });
      }
    });

    return zones;
  }, [collaborations]);

  if (lines.length === 0 && meetingZones.length === 0) return null;

  return (
    <g className="communication-lines" style={{ willChange: 'transform' }}>
      {/* Meeting zones (background) */}
      {meetingZones.map((zone) => (
        <MeetingZone
          key={zone.key}
          participants={zone.participants}
          color={zone.color}
          isFading={zone.isFading}
        />
      ))}

      {/* Communication lines */}
      {lines.map((line) => (
        <CollaborationLine
          key={line.key}
          from={line.from}
          to={line.to}
          color={line.color}
          status={line.status}
          index={line.index}
        />
      ))}
    </g>
  );
}
