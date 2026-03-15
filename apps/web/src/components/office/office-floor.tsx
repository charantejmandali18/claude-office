'use client';

import { useAgentStore } from '@/store/agent-store';
import { AgentAvatar } from './agent-avatar';
import { ZoneLabel } from './zone-label';

export function OfficeFloor() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <svg
      viewBox="0 0 860 620"
      className="w-full h-full"
      style={{ background: '#0d1117' }}
    >
      {/* Definitions */}
      <defs>
        {/* Floor grid */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#161b22" strokeWidth="0.5" />
        </pattern>

        {/* Isometric grid overlay */}
        <pattern id="iso-grid" width="40" height="23.1" patternUnits="userSpaceOnUse">
          <path d="M 0,23.1 L 20,11.55 L 40,23.1" fill="none" stroke="#13171d" strokeWidth="0.3" />
        </pattern>

        {/* Soft glow for active zones */}
        <filter id="zone-glow">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Base floor */}
      <rect width="860" height="620" fill="url(#grid)" />
      <rect width="860" height="620" fill="url(#iso-grid)" opacity={0.3} />

      {/* Zone boundaries — Executive Wing (top left) */}
      <rect x={30} y={40} width={370} height={250} rx={8}
        fill="#161b22" fillOpacity={0.4}
        stroke="#1c2128" strokeWidth={1}
      />
      <rect x={30} y={40} width={370} height={3} rx={1.5}
        fill="#d2a8ff" opacity={0.3}
      />
      <ZoneLabel x={42} y={60} label="Executive Wing" />

      {/* Zone: Engineering Floor (top right) */}
      <rect x={420} y={40} width={410} height={250} rx={8}
        fill="#161b22" fillOpacity={0.4}
        stroke="#1c2128" strokeWidth={1}
      />
      <rect x={420} y={40} width={410} height={3} rx={1.5}
        fill="#58a6ff" opacity={0.3}
      />
      <ZoneLabel x={432} y={60} label="Engineering Floor" />

      {/* Zone: Quality Lab (bottom left) */}
      <rect x={30} y={325} width={370} height={260} rx={8}
        fill="#161b22" fillOpacity={0.4}
        stroke="#1c2128" strokeWidth={1}
      />
      <rect x={30} y={325} width={370} height={3} rx={1.5}
        fill="#3fb950" opacity={0.3}
      />
      <ZoneLabel x={42} y={345} label="Quality Lab" />

      {/* Zone: Ops Center (bottom right) */}
      <rect x={420} y={325} width={410} height={260} rx={8}
        fill="#161b22" fillOpacity={0.4}
        stroke="#1c2128" strokeWidth={1}
      />
      <rect x={420} y={325} width={410} height={3} rx={1.5}
        fill="#f0883e" opacity={0.3}
      />
      <ZoneLabel x={432} y={345} label="Ops Center" />

      {/* Central corridor */}
      <rect x={30} y={294} width={800} height={27} rx={4}
        fill="#0d1117" fillOpacity={0.6}
      />
      <line x1={60} y1={307} x2={800} y2={307}
        stroke="#1c2128" strokeWidth={1} strokeDasharray="12 6" opacity={0.5}
      />
      {/* Corridor label */}
      <text x={430} y={311} textAnchor="middle" fill="#30363d" fontSize={8} fontFamily="system-ui, sans-serif">
        — corridor —
      </text>

      {/* Decorative elements — plants */}
      <circle cx={410} cy={50} r={3} fill="#3fb950" opacity={0.3} />
      <circle cx={410} cy={330} r={3} fill="#3fb950" opacity={0.3} />

      {/* Agent workstations */}
      {[...agents.values()].map((agent) => (
        <AgentAvatar key={agent.configId} agent={agent} />
      ))}
    </svg>
  );
}
