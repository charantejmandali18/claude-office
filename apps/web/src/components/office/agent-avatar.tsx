'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { generateAvatar, type AvatarData } from '@/lib/avatar-generator';
import type { AgentState } from '@/store/agent-store';

const R = 20; // avatar radius

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#6b7280',
  IDLE: '#22c55e',
  THINKING: '#3b82f6',
  TOOL_CALLING: '#f97316',
  SPEAKING: '#a855f7',
  COLLABORATING: '#06b6d4',
  ERROR: '#ef4444',
};

// Movement offsets: when working, agent slides forward from desk
function getMotionOffset(status: string): { dx: number; dy: number } {
  switch (status) {
    case 'THINKING':    return { dx: 0, dy: -8 };
    case 'TOOL_CALLING': return { dx: 4, dy: -4 };
    case 'SPEAKING':    return { dx: 0, dy: -12 };
    case 'COLLABORATING': return { dx: 6, dy: -6 };
    case 'ERROR':       return { dx: 0, dy: 2 };
    default:            return { dx: 0, dy: 0 };
  }
}

// ── Face sub-components ──────────────────────────────────────

function HairShape({ style, color, cx, cy, r }: {
  style: string; color: string; cx: number; cy: number; r: number;
}) {
  const s = r / 20;
  const faceW = r * 0.8;

  switch (style) {
    case 'short':
      return <ellipse cx={cx} cy={cy - r * 0.4} rx={faceW * 1.05} ry={r * 0.5} fill={color} />;
    case 'spiky':
      return (
        <g>
          <ellipse cx={cx} cy={cy - r * 0.35} rx={faceW} ry={r * 0.45} fill={color} />
          <polygon points={`${cx - 6 * s},${cy - r * 0.65} ${cx - 3 * s},${cy - r * 1.1} ${cx},${cy - r * 0.65}`} fill={color} />
          <polygon points={`${cx - 2 * s},${cy - r * 0.7} ${cx + 1 * s},${cy - r * 1.15} ${cx + 4 * s},${cy - r * 0.7}`} fill={color} />
          <polygon points={`${cx + 2 * s},${cy - r * 0.65} ${cx + 5 * s},${cy - r * 1.05} ${cx + 8 * s},${cy - r * 0.6}`} fill={color} />
        </g>
      );
    case 'side-part':
      return (
        <g>
          <ellipse cx={cx + 2 * s} cy={cy - r * 0.4} rx={faceW * 1.1} ry={r * 0.5} fill={color} />
          <ellipse cx={cx - r * 0.5} cy={cy - r * 0.1} rx={4 * s} ry={r * 0.4} fill={color} />
        </g>
      );
    case 'curly':
      return (
        <g>
          <circle cx={cx - 5 * s} cy={cy - r * 0.55} r={6 * s} fill={color} />
          <circle cx={cx + 5 * s} cy={cy - r * 0.55} r={6 * s} fill={color} />
          <circle cx={cx} cy={cy - r * 0.65} r={7 * s} fill={color} />
          <circle cx={cx - 8 * s} cy={cy - r * 0.2} r={4 * s} fill={color} />
          <circle cx={cx + 8 * s} cy={cy - r * 0.2} r={4 * s} fill={color} />
        </g>
      );
    case 'buzz':
      return <ellipse cx={cx} cy={cy - r * 0.35} rx={faceW * 0.95} ry={r * 0.4} fill={color} />;
    default:
      return <ellipse cx={cx} cy={cy - r * 0.4} rx={faceW} ry={r * 0.45} fill={color} />;
  }
}

function Eyes({ style, cx, cy, r }: { style: string; cx: number; cy: number; r: number }) {
  const s = r / 20;
  const ey = cy + r * 0.05;
  const gap = 5 * s;

  switch (style) {
    case 'dot':
      return (
        <g>
          <circle cx={cx - gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
        </g>
      );
    case 'line':
      return (
        <g>
          <line x1={cx - gap - 2 * s} y1={ey} x2={cx - gap + 2 * s} y2={ey} stroke="#1a1a2e" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={cx + gap - 2 * s} y1={ey} x2={cx + gap + 2 * s} y2={ey} stroke="#1a1a2e" strokeWidth={1.5} strokeLinecap="round" />
        </g>
      );
    case 'wide':
      return (
        <g>
          <ellipse cx={cx - gap} cy={ey} rx={3 * s} ry={2.5 * s} fill="#fff" />
          <ellipse cx={cx + gap} cy={ey} rx={3 * s} ry={2.5 * s} fill="#fff" />
          <circle cx={cx - gap} cy={ey} r={1.5 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.5 * s} fill="#1a1a2e" />
          <circle cx={cx - gap + 0.5 * s} cy={ey - 0.5 * s} r={0.6 * s} fill="#fff" />
          <circle cx={cx + gap + 0.5 * s} cy={ey - 0.5 * s} r={0.6 * s} fill="#fff" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx={cx - gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
        </g>
      );
  }
}

function AvatarFace({ data, cx, cy, r }: { data: AvatarData; cx: number; cy: number; r: number }) {
  const s = r / 20;
  const faceRx = data.faceShape === 'square' ? r * 0.85 : data.faceShape === 'oval' ? r * 0.72 : r * 0.78;
  const faceRy = data.faceShape === 'square' ? r * 0.75 : data.faceShape === 'oval' ? r * 0.85 : r * 0.78;

  return (
    <g>
      {/* Shirt / body */}
      <ellipse cx={cx} cy={cy + r * 0.9} rx={r * 0.7} ry={r * 0.5} fill={data.shirtColor} />
      {/* Neck */}
      <rect x={cx - 3 * s} y={cy + r * 0.25} width={6 * s} height={8 * s} fill={data.skinColor} />
      {/* Face */}
      <ellipse cx={cx} cy={cy - r * 0.05} rx={faceRx} ry={faceRy} fill={data.skinColor} />
      {/* Hair */}
      <HairShape style={data.hairStyle} color={data.hairColor} cx={cx} cy={cy} r={r} />
      {/* Eyes */}
      <Eyes style={data.eyeStyle} cx={cx} cy={cy} r={r} />
      {/* Mouth */}
      <path
        d={`M ${cx - 3 * s} ${cy + r * 0.28} Q ${cx} ${cy + r * 0.38} ${cx + 3 * s} ${cy + r * 0.28}`}
        fill="none" stroke="#1a1a2e" strokeWidth={0.8} opacity={0.35}
      />
    </g>
  );
}

// ── Main avatar (placed in the office SVG) ───────────────────

export function AgentAvatar({ agent }: { agent: AgentState }) {
  const avatar = generateAvatar(agent.configId);
  const color = STATUS_COLORS[agent.status] ?? '#6b7280';
  const isActive = agent.status !== 'OFFLINE';
  const isWorking = ['THINKING', 'TOOL_CALLING', 'SPEAKING', 'COLLABORATING'].includes(agent.status);
  const clipId = `clip-${agent.configId}`;

  const offset = useMemo(() => getMotionOffset(agent.status), [agent.status]);

  // Idle agents get a subtle breathing animation; working agents get a bob
  const bobAnimation = isWorking
    ? { y: [0, -3, 0, 2, 0] }
    : isActive
      ? { y: [0, -1.5, 0] }
      : {};
  const bobTransition = isWorking
    ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' as const }
    : isActive
      ? { duration: 4, repeat: Infinity, ease: 'easeInOut' as const }
      : {};

  return (
    <motion.g
      initial={false}
      animate={{
        x: agent.position.x + offset.dx,
        y: agent.position.y + offset.dy,
      }}
      transition={{
        type: 'spring',
        stiffness: 80,
        damping: 18,
        mass: 0.8,
      }}
    >
      {/* Inner bobbing animation */}
      <motion.g
        animate={bobAnimation}
        transition={bobTransition}
      >
        {/* Shadow on the ground */}
        {isActive && (
          <motion.ellipse
            cx={0} cy={R + 8} rx={R - 2} ry={4}
            fill="#000" opacity={0.15}
            animate={isWorking ? { rx: [R - 2, R, R - 2], opacity: [0.15, 0.1, 0.15] } : {}}
            transition={isWorking ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } : {}}
          />
        )}

        {/* Pulse glow */}
        {isWorking && (
          <motion.circle
            cx={0} cy={0} r={R + 6}
            fill="none" stroke={color} strokeWidth={2} opacity={0.25}
            animate={{ r: [R + 6, R + 10, R + 6], opacity: [0.25, 0.08, 0.25] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Status ring */}
        <circle
          cx={0} cy={0} r={R + 2}
          fill="none"
          stroke={color}
          strokeWidth={isWorking ? 3 : 2}
          strokeDasharray={agent.status === 'TOOL_CALLING' ? '6 3' : undefined}
          opacity={isActive ? 1 : 0.25}
        />

        {/* Spinning dash for TOOL_CALLING */}
        {agent.status === 'TOOL_CALLING' && (
          <motion.circle
            cx={0} cy={0} r={R + 2}
            fill="none" stroke={color} strokeWidth={2}
            strokeDasharray="6 3"
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* Avatar background */}
        <circle cx={0} cy={0} r={R} fill="#1e293b" />

        {/* Clipped face */}
        <defs>
          <clipPath id={clipId}>
            <circle cx={0} cy={0} r={R} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <AvatarFace data={avatar} cx={0} cy={0} r={R} />
        </g>

        {/* Thinking dots */}
        {agent.status === 'THINKING' && (
          <g transform="translate(16, -16)">
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={i}
                cx={i * 5} cy={0} r={2}
                fill={color}
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </g>
        )}

        {/* Speaking indicator — waveform */}
        {agent.status === 'SPEAKING' && (
          <g transform="translate(16, -16)">
            <motion.rect x={0} y={-4} width={2} height={8} rx={1} fill={color}
              animate={{ scaleY: [0.4, 1, 0.4] }} transition={{ duration: 0.5, repeat: Infinity }} />
            <motion.rect x={4} y={-3} width={2} height={6} rx={1} fill={color}
              animate={{ scaleY: [1, 0.4, 1] }} transition={{ duration: 0.5, repeat: Infinity }} />
            <motion.rect x={8} y={-4} width={2} height={8} rx={1} fill={color}
              animate={{ scaleY: [0.6, 1, 0.6] }} transition={{ duration: 0.5, repeat: Infinity, delay: 0.15 }} />
          </g>
        )}

        {/* Tool badge */}
        {agent.currentTool && (
          <motion.g
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          >
            <g transform="translate(0, 32)">
              <rect
                x={-(agent.currentTool.length * 3.2 + 10) / 2} y={0}
                width={agent.currentTool.length * 3.2 + 10} height={13}
                rx={6.5} fill="#f97316"
              />
              <text x={0} y={7.5} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize={7} fontWeight="600" fontFamily="system-ui">
                {agent.currentTool}
              </text>
            </g>
          </motion.g>
        )}

        {/* Name label (glassmorphic pill) */}
        <g transform={`translate(0, ${agent.currentTool ? 48 : 30})`}>
          <rect
            x={-34} y={0} width={68} height={16} rx={8}
            fill="rgba(15, 23, 42, 0.85)"
            stroke="rgba(51, 65, 85, 0.4)"
            strokeWidth={0.5}
          />
          <text x={0} y={9} textAnchor="middle" dominantBaseline="central"
            fill={isActive ? '#e2e8f0' : '#64748b'}
            fontSize={7} fontWeight={isWorking ? 600 : 400} fontFamily="system-ui">
            {agent.name.length > 14 ? agent.name.slice(0, 12) + '\u2026' : agent.name}
          </text>
        </g>

        {/* Speech bubble */}
        {agent.speechBubble && agent.status === 'SPEAKING' && (
          <motion.g
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 12 }}
          >
            <g transform="translate(0, -40)">
              <rect x={-55} y={-10} width={110} height={18} rx={9}
                fill="rgba(168, 85, 247, 0.92)" />
              <polygon points="-4,8 4,8 0,14" fill="rgba(168, 85, 247, 0.92)" />
              <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize={7} fontFamily="system-ui">
                {agent.speechBubble.length > 26 ? agent.speechBubble.slice(0, 24) + '\u2026' : agent.speechBubble}
              </text>
            </g>
          </motion.g>
        )}
      </motion.g>
    </motion.g>
  );
}

// ── Small avatar for sidebar list ────────────────────────────

export function SidebarAvatar({ agentId, size = 28 }: { agentId: string; size?: number }) {
  const data = generateAvatar(agentId);
  const r = size / 2;
  const clipId = `sidebar-clip-${agentId}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      </defs>
      <circle cx={r} cy={r} r={r} fill="#1e293b" />
      <g clipPath={`url(#${clipId})`}>
        <AvatarFace data={data} cx={r} cy={r} r={r} />
      </g>
    </svg>
  );
}
