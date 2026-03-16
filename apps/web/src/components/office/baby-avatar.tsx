'use client';

import { useRef, useEffect } from 'react';
import { animate, spring } from 'animejs';
import type { BabyAgentType } from '@rigelhq/shared';

const R = 16; // baby avatar radius (vs 26 for regular agents)

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#555d68',
  IDLE: '#3a9050',
  THINKING: '#4a7ab0',
  TOOL_CALLING: '#b07a40',
  SPEAKING: '#8a6abf',
  COLLABORATING: '#3a90a0',
  ERROR: '#b84a42',
};

// SVG icon paths for each baby agent type (rendered at center)
function BabyIcon({ type, cx, cy }: { type: BabyAgentType; cx: number; cy: number }) {
  const s = 0.55; // scale factor for icons within 16px radius
  switch (type) {
    case 'Explore':
      // Magnifying glass
      return (
        <g transform={`translate(${cx - 6 * s}, ${cy - 6 * s}) scale(${s})`}>
          <circle cx={9} cy={8} r={5} fill="none" stroke="var(--office-name-active)" strokeWidth={2} />
          <line x1={13} y1={12} x2={18} y2={17} stroke="var(--office-name-active)" strokeWidth={2} strokeLinecap="round" />
        </g>
      );
    case 'Plan':
      // Clipboard
      return (
        <g transform={`translate(${cx - 6 * s}, ${cy - 7 * s}) scale(${s})`}>
          <rect x={3} y={3} width={14} height={16} rx={2} fill="none" stroke="var(--office-name-active)" strokeWidth={1.8} />
          <rect x={7} y={1} width={6} height={4} rx={1} fill="var(--office-name-active)" />
          <line x1={6} y1={10} x2={14} y2={10} stroke="var(--office-name-active)" strokeWidth={1.2} />
          <line x1={6} y1={13} x2={12} y2={13} stroke="var(--office-name-active)" strokeWidth={1.2} />
          <line x1={6} y1={16} x2={10} y2={16} stroke="var(--office-name-active)" strokeWidth={1.2} />
        </g>
      );
    case 'general-purpose':
    default:
      // Gear
      return (
        <g transform={`translate(${cx - 7 * s}, ${cy - 7 * s}) scale(${s})`}>
          <circle cx={10} cy={10} r={3.5} fill="none" stroke="var(--office-name-active)" strokeWidth={1.8} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
            const rad = (angle * Math.PI) / 180;
            const x1 = 10 + Math.cos(rad) * 5;
            const y1 = 10 + Math.sin(rad) * 5;
            const x2 = 10 + Math.cos(rad) * 7;
            const y2 = 10 + Math.sin(rad) * 7;
            return (
              <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="var(--office-name-active)" strokeWidth={1.8} strokeLinecap="round" />
            );
          })}
        </g>
      );
  }
}

export interface BabyAvatarProps {
  taskId: string;
  parentPosition: { x: number; y: number };
  position: { x: number; y: number };
  type: BabyAgentType;
  icon: string;
  status: string;
}

export function BabyAvatar({ taskId, parentPosition, position, type, status }: BabyAvatarProps) {
  const color = STATUS_COLORS[status] ?? '#6b7280';
  const isActive = status !== 'OFFLINE';
  const isWorking = ['THINKING', 'TOOL_CALLING', 'SPEAKING', 'COLLABORATING'].includes(status);

  // Refs for animations
  const groupRef = useRef<SVGGElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);

  // Pop-in animation on mount (scale 0 -> 1)
  useEffect(() => {
    if (!groupRef.current) return;
    const anim = animate(groupRef.current, {
      scale: [0, 1],
      opacity: [0, 1],
      ease: spring({ stiffness: 220, damping: 16 }),
    });
    return () => { anim.pause(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pulse glow when working
  useEffect(() => {
    if (!pulseRef.current) return;
    if (!isWorking) {
      pulseRef.current.setAttribute('opacity', '0');
      return;
    }
    const anim = animate(pulseRef.current, {
      r: [R + 3, R + 8, R + 3],
      opacity: [0.25, 0.05, 0.25],
      ease: 'inOutQuad',
      duration: 2200,
      loop: true,
    });
    return () => { anim.pause(); };
  }, [isWorking]);

  return (
    <g
      ref={groupRef}
      style={{
        transform: `translateX(${position.x}px) translateY(${position.y}px)`,
        transformOrigin: `${position.x}px ${position.y}px`,
      }}
      data-baby-task={taskId}
    >
      {/* Dotted connecting line from baby to parent */}
      <line
        x1={0} y1={0}
        x2={parentPosition.x - position.x} y2={parentPosition.y - position.y}
        stroke={color} strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.35}
      />

      {/* Ground shadow */}
      <ellipse
        cx={0} cy={R + 6} rx={R - 4} ry={3}
        fill="#000" opacity={isActive ? 0.1 : 0}
      />

      {/* Pulse glow ring */}
      <circle
        ref={pulseRef}
        cx={0} cy={0} r={R + 3}
        fill="none" stroke={color} strokeWidth={1.5}
        opacity={0}
      />

      {/* Status ring (thinner than regular agents) */}
      <circle
        cx={0} cy={0} r={R + 1}
        fill="none" stroke={color}
        strokeWidth={isWorking ? 2 : 1.5}
        strokeDasharray={status === 'TOOL_CALLING' ? '4 2' : undefined}
        opacity={isActive ? 1 : 0.25}
      />

      {/* Avatar disc */}
      <circle cx={0} cy={0} r={R} style={{ fill: 'var(--office-avatar-disc)' }} />

      {/* Center icon */}
      <BabyIcon type={type} cx={0} cy={0} />

      {/* Type label below */}
      <g transform={`translate(0, ${R + 14})`}>
        <rect
          x={-30} y={0} width={60} height={14} rx={7}
          style={{ fill: 'var(--office-name-bg)', stroke: 'var(--office-name-stroke)' }}
          strokeWidth={0.5}
        />
        <text x={0} y={8} textAnchor="middle" dominantBaseline="central"
          style={{ fill: isActive ? 'var(--office-name-active)' : 'var(--office-name-inactive)' }}
          fontSize={8} fontWeight={500} fontFamily="system-ui">
          {type}
        </text>
      </g>
    </g>
  );
}
