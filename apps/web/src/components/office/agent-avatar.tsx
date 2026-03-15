'use client';

import { motion } from 'framer-motion';
import type { AgentState } from '@/store/agent-store';

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#30363d',
  IDLE: '#3fb950',
  THINKING: '#58a6ff',
  TOOL_CALLING: '#f0883e',
  SPEAKING: '#d2a8ff',
  COLLABORATING: '#56d4dd',
  ERROR: '#f85149',
};

const STATUS_LABELS: Record<string, string> = {
  THINKING: '💭',
  TOOL_CALLING: '⚡',
  SPEAKING: '💬',
  ERROR: '⚠️',
};

export function AgentAvatar({ agent }: { agent: AgentState }) {
  const color = STATUS_COLORS[agent.status] ?? '#30363d';
  const isActive = agent.status !== 'OFFLINE';
  const isWorking = ['THINKING', 'TOOL_CALLING', 'SPEAKING', 'COLLABORATING'].includes(agent.status);

  return (
    <g transform={`translate(${agent.position.x}, ${agent.position.y})`}>
      {/* Workstation glow */}
      {isWorking && (
        <motion.ellipse
          cx={0}
          cy={8}
          rx={38}
          ry={26}
          fill={color}
          opacity={0.08}
          animate={{ opacity: [0.05, 0.12, 0.05], rx: [38, 40, 38] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Desk surface — isometric diamond */}
      <polygon
        points="0,-14 32,0 0,14 -32,0"
        fill={isActive ? '#1c2128' : '#13171d'}
        stroke={isActive ? '#2d333b' : '#1c2128'}
        strokeWidth={1}
      />

      {/* Monitor back (isometric) */}
      <polygon
        points="-10,-14 10,-14 10,-30 -10,-30"
        fill="#21262d"
        stroke="#30363d"
        strokeWidth={0.5}
      />

      {/* Monitor screen */}
      <rect
        x={-8}
        y={-28}
        width={16}
        height={12}
        rx={1}
        fill={isActive ? '#0d1117' : '#0a0e14'}
        stroke={isWorking ? color : '#30363d'}
        strokeWidth={isWorking ? 1 : 0.5}
      />

      {/* Screen content — shows activity */}
      {isWorking && (
        <g>
          <motion.rect
            x={-6}
            y={-26}
            width={12}
            height={1.5}
            rx={0.5}
            fill={color}
            opacity={0.6}
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          <rect x={-6} y={-23} width={8} height={1} rx={0.5} fill="#30363d" opacity={0.4} />
          <rect x={-6} y={-21} width={10} height={1} rx={0.5} fill="#30363d" opacity={0.3} />
        </g>
      )}

      {/* Monitor stand */}
      <line x1={0} y1={-14} x2={0} y2={-11} stroke="#30363d" strokeWidth={2} />

      {/* Character — simplified sitting figure */}
      <g transform="translate(0, -4)">
        {/* Body */}
        <ellipse
          cx={0}
          cy={2}
          rx={7}
          ry={5}
          fill={isActive ? '#2d333b' : '#1c2128'}
        />
        {/* Head */}
        <circle
          cx={0}
          cy={-6}
          r={5}
          fill={isActive ? '#2d333b' : '#1c2128'}
          stroke={color}
          strokeWidth={isWorking ? 1.5 : 0.5}
        />
        {/* Face icon */}
        <text
          x={0}
          y={-5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={7}
          style={{ userSelect: 'none' }}
        >
          {agent.icon}
        </text>
      </g>

      {/* Chair back (behind character) */}
      <path
        d="M-8,8 Q0,2 8,8"
        fill="none"
        stroke="#21262d"
        strokeWidth={2}
      />

      {/* Status indicator dot */}
      <circle
        cx={18}
        cy={-28}
        r={3}
        fill={color}
      />
      {isWorking && (
        <motion.circle
          cx={18}
          cy={-28}
          r={3}
          fill="none"
          stroke={color}
          strokeWidth={1}
          animate={{ r: [3, 6, 3], opacity: [1, 0, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* Agent name plate */}
      <rect
        x={-28}
        y={20}
        width={56}
        height={14}
        rx={3}
        fill="#161b22"
        stroke={isActive ? '#2d333b' : '#1c2128'}
        strokeWidth={0.5}
      />
      <text
        x={0}
        y={28}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isActive ? '#8b949e' : '#484f58'}
        fontSize={7}
        fontFamily="system-ui, sans-serif"
        fontWeight={isWorking ? 600 : 400}
      >
        {agent.name.length > 14 ? agent.name.slice(0, 12) + '…' : agent.name}
      </text>

      {/* Status emoji badge */}
      {STATUS_LABELS[agent.status] && (
        <text
          x={-20}
          y={-28}
          fontSize={9}
          style={{ userSelect: 'none' }}
        >
          {STATUS_LABELS[agent.status]}
        </text>
      )}

      {/* Tool badge */}
      {agent.currentTool && (
        <g transform="translate(22, -8)">
          <rect x={0} y={-6} width={agent.currentTool.length * 4.5 + 8} height={12} rx={3} fill="#f0883e" opacity={0.9} />
          <text x={4} y={1} fill="#0f1419" fontSize={7} fontWeight="bold" fontFamily="monospace" dominantBaseline="central">
            {agent.currentTool}
          </text>
        </g>
      )}

      {/* Speech bubble */}
      {agent.speechBubble && agent.status === 'SPEAKING' && (
        <g transform="translate(0, -48)">
          <rect
            x={-55}
            y={-12}
            width={110}
            height={20}
            rx={6}
            fill="#d2a8ff"
            opacity={0.9}
          />
          <polygon points="-3,8 3,8 0,13" fill="#d2a8ff" opacity={0.9} />
          <text
            x={0}
            y={-2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#0f1419"
            fontSize={7}
            fontFamily="system-ui, sans-serif"
          >
            {agent.speechBubble.length > 26 ? agent.speechBubble.slice(0, 24) + '…' : agent.speechBubble}
          </text>
        </g>
      )}
    </g>
  );
}
