'use client';

import { useAgentStore } from '@/store/agent-store';
import { AgentAvatar } from './agent-avatar';
import { CommunicationLines } from './communication-lines';

// Helper: shorthand for var()
const v = (name: string) => `var(--office-${name})`;

// ── Furniture sub-components ──────────────────────────────────

function DeskUnit({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {/* Desk surface */}
      <rect x={x - 44} y={y - 58} width={88} height={34} rx={3}
        style={{ fill: v('desk'), stroke: v('furniture-stroke') }} strokeWidth={0.5} />
      {/* Monitor */}
      <rect x={x - 13} y={y - 54} width={26} height={18} rx={2}
        style={{ fill: v('monitor'), stroke: v('furniture-stroke') }} strokeWidth={0.4} />
      {/* Screen glow */}
      <rect x={x - 11} y={y - 52} width={22} height={14} rx={1.5}
        style={{ fill: v('screen') }} opacity={0.4} />
      {/* Keyboard */}
      <rect x={x - 10} y={y - 32} width={20} height={6} rx={1}
        style={{ fill: v('keyboard'), stroke: v('furniture-stroke') }} strokeWidth={0.3} />
      {/* Chair */}
      <ellipse cx={x} cy={y + 44} rx={16} ry={12}
        style={{ fill: v('chair'), stroke: v('furniture-stroke') }} strokeWidth={0.4} />
      {/* Chair back */}
      <rect x={x - 12} y={y + 32} width={24} height={7} rx={3.5}
        style={{ fill: v('chair-back'), stroke: v('furniture-stroke') }} strokeWidth={0.3} />
    </g>
  );
}

function MeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {/* Circular table */}
      <circle cx={x} cy={y} r={28} style={{ fill: v('desk'), stroke: v('furniture-stroke') }} strokeWidth={0.5} />
      {/* Table center marker */}
      <circle cx={x} cy={y} r={4} style={{ fill: v('table-center') }} opacity={0.3} />
      {/* Chairs around table */}
      {[0, 60, 120, 180, 240, 300].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const cx = x + Math.cos(rad) * 40;
        const cy = y + Math.sin(rad) * 40;
        return (
          <ellipse key={angle} cx={cx} cy={cy} rx={8} ry={6}
            style={{ fill: v('chair'), stroke: v('furniture-stroke') }} strokeWidth={0.3}
            transform={`rotate(${angle}, ${cx}, ${cy})`} />
        );
      })}
    </g>
  );
}

function Sofa({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  const s = flip ? -1 : 1;
  return (
    <g transform={`translate(${x}, ${y}) scale(${s}, 1)`}>
      {/* Back rest */}
      <rect x={-22} y={-12} width={44} height={8} rx={4}
        style={{ fill: v('sofa-back'), stroke: v('sofa-stroke') }} strokeWidth={0.4} />
      {/* Seat cushions */}
      <rect x={-20} y={-4} width={18} height={14} rx={3}
        style={{ fill: v('sofa-seat'), stroke: v('sofa-stroke') }} strokeWidth={0.3} />
      <rect x={2} y={-4} width={18} height={14} rx={3}
        style={{ fill: v('sofa-seat'), stroke: v('sofa-stroke') }} strokeWidth={0.3} />
      {/* Arm rests */}
      <rect x={-26} y={-8} width={6} height={20} rx={3}
        style={{ fill: v('sofa-back'), stroke: v('sofa-stroke') }} strokeWidth={0.3} />
      <rect x={20} y={-8} width={6} height={20} rx={3}
        style={{ fill: v('sofa-back'), stroke: v('sofa-stroke') }} strokeWidth={0.3} />
    </g>
  );
}

function Plant({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const s = size;
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Pot */}
      <rect x={-6 * s} y={2 * s} width={12 * s} height={10 * s} rx={2}
        style={{ fill: v('pot'), stroke: v('pot-stroke') }} strokeWidth={0.4} />
      {/* Soil */}
      <ellipse cx={0} cy={2 * s} rx={6 * s} ry={2 * s}
        style={{ fill: v('soil') }} />
      {/* Leaves */}
      <ellipse cx={-4 * s} cy={-6 * s} rx={6 * s} ry={8 * s}
        style={{ fill: v('leaf1') }} opacity={0.7} transform={`rotate(-15, ${-4 * s}, ${-6 * s})`} />
      <ellipse cx={4 * s} cy={-7 * s} rx={5 * s} ry={9 * s}
        style={{ fill: v('leaf2') }} opacity={0.65} transform={`rotate(12, ${4 * s}, ${-7 * s})`} />
      <ellipse cx={0} cy={-10 * s} rx={4 * s} ry={7 * s}
        style={{ fill: v('leaf3') }} opacity={0.55} />
    </g>
  );
}

function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Base */}
      <rect x={-8} y={4} width={16} height={14} rx={2}
        style={{ fill: v('cooler-base'), stroke: v('cooler-base-stroke') }} strokeWidth={0.4} />
      {/* Tank */}
      <rect x={-6} y={-12} width={12} height={16} rx={6}
        style={{ fill: v('cooler-tank'), stroke: v('cooler-tank-stroke') }} opacity={0.2} strokeWidth={0.4} />
      {/* Water level */}
      <rect x={-5} y={-6} width={10} height={10} rx={5}
        style={{ fill: v('cooler-water') }} opacity={0.12} />
    </g>
  );
}

// ── Zone label ────────────────────────────────────────────────

function ZoneLabel({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x - 2} y={y - 10} width={label.length * 7.5 + 8} height={14} rx={3}
        fill={color} opacity={0.12} />
      <text x={x + 2} y={y} fill={color} fontSize={9} fontWeight="700"
        fontFamily="system-ui, sans-serif" letterSpacing="0.08em"
        opacity={0.8} style={{ textTransform: 'uppercase' } as React.CSSProperties}>
        {label}
      </text>
    </g>
  );
}

// ── Main office floor ─────────────────────────────────────────

export function OfficeFloor() {
  const agents = useAgentStore((s) => s.agents);
  const agentList = [...agents.values()];

  // Corridor dimensions
  const CX = 586; // vertical corridor left edge
  const CW = 28;  // corridor width
  const CY = 336; // horizontal corridor top edge

  return (
    <svg
      viewBox="0 -100 1200 800"
      className="w-full h-full"
      style={{ background: v('bg') }}
    >
      <defs>
        {/* Subtle floor tile pattern */}
        <pattern id="floor-tile" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" style={{ fill: v('floor') }} />
          <path d="M 40 0 L 0 0 0 40" fill="none" style={{ stroke: v('floor-line') }} strokeWidth={0.3} />
        </pattern>

        {/* Corridor tile pattern */}
        <pattern id="corridor-tile" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" style={{ fill: v('corridor') }} />
          <rect x={1} y={1} width={12} height={12} rx={1} style={{ fill: v('corridor-sub') }} opacity={0.5} />
          <rect x={15} y={1} width={12} height={12} rx={1} style={{ fill: v('corridor-sub') }} opacity={0.5} />
          <rect x={1} y={15} width={12} height={12} rx={1} style={{ fill: v('corridor-sub') }} opacity={0.5} />
          <rect x={15} y={15} width={12} height={12} rx={1} style={{ fill: v('corridor-sub') }} opacity={0.5} />
        </pattern>

        {/* Glow filter for active elements */}
        <filter id="zone-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ─── Layer 1: Base floor ─── */}
      <rect y="-100" width="1200" height="800" fill="url(#floor-tile)" />

      {/* ─── Layer 2: Building shell (outer walls) ─── */}
      <rect x={8} y={8} width={1184} height={684} rx={6}
        fill="none" style={{ stroke: v('wall') }} strokeWidth={2} />
      {/* Inner wall shadow */}
      <rect x={10} y={10} width={1180} height={680} rx={5}
        fill="none" style={{ stroke: v('wall-inner') }} strokeWidth={1} />

      {/* ─── CEA Suite (top center, above the office) ─── */}
      <rect x={480} y={-88} width={240} height={80} rx={8}
        style={{ fill: v('zone-exec') }} opacity={0.35} />
      <rect x={480} y={-88} width={240} height={3} rx={1.5}
        fill="#8a6abf" opacity={0.5} />
      <rect x={480} y={-88} width={240} height={80} rx={8}
        fill="none" style={{ stroke: v('wall') }} strokeWidth={1.5} />
      <ZoneLabel x={545} y={-70} label="CEA Suite" color="#8a6abf" />

      {/* ─── Layer 3: Zone backgrounds ─── */}
      {/* Executive Wing (top-left) */}
      <rect x={14} y={14} width={CX - 14} height={CY - 14} rx={4}
        style={{ fill: v('zone-exec') }} opacity={0.25} />
      {/* Engineering Floor (top-right) */}
      <rect x={CX + CW} y={14} width={1186 - CX - CW} height={CY - 14} rx={4}
        style={{ fill: v('zone-eng') }} opacity={0.25} />
      {/* Quality Lab (bottom-left) */}
      <rect x={14} y={CY + CW} width={CX - 14} height={686 - CY - CW} rx={4}
        style={{ fill: v('zone-qa') }} opacity={0.25} />
      {/* Ops Center (bottom-right) */}
      <rect x={CX + CW} y={CY + CW} width={1186 - CX - CW} height={686 - CY - CW} rx={4}
        style={{ fill: v('zone-ops') }} opacity={0.25} />

      {/* Zone accent bars (top edge) */}
      <rect x={14} y={14} width={CX - 14} height={2} rx={1}
        fill="#8a6abf" opacity={0.3} />
      <rect x={CX + CW} y={14} width={1186 - CX - CW} height={2} rx={1}
        fill="#4a7ab0" opacity={0.3} />
      <rect x={14} y={CY + CW} width={CX - 14} height={2} rx={1}
        fill="#3a8a55" opacity={0.3} />
      <rect x={CX + CW} y={CY + CW} width={1186 - CX - CW} height={2} rx={1}
        fill="#b07a40" opacity={0.3} />

      {/* ─── Layer 4: Cross corridor ─── */}
      {/* Horizontal corridor */}
      <rect x={14} y={CY} width={1172} height={CW} fill="url(#corridor-tile)" />
      {/* Vertical corridor */}
      <rect x={CX} y={14} width={CW} height={672} fill="url(#corridor-tile)" />
      {/* Corridor center lines */}
      <line x1={14} y1={CY + CW / 2} x2={1186} y2={CY + CW / 2}
        style={{ stroke: v('corridor-dash') }} strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />
      <line x1={CX + CW / 2} y1={14} x2={CX + CW / 2} y2={686}
        style={{ stroke: v('corridor-dash') }} strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />

      {/* ─── Layer 5: Zone labels ─── */}
      <ZoneLabel x={28} y={38} label="Executive Wing" color="#8a6abf" />
      <ZoneLabel x={CX + CW + 14} y={38} label="Engineering Floor" color="#4a7ab0" />
      <ZoneLabel x={28} y={CY + CW + 24} label="Quality Lab" color="#3a8a55" />
      <ZoneLabel x={CX + CW + 14} y={CY + CW + 24} label="Ops Center" color="#b07a40" />

      {/* ─── Layer 6: Furniture ─── */}
      {/* Desks at each agent position (skip CEA — has special suite) */}
      {agentList.filter((a) => a.zone !== 'ceo-suite').map((agent) => (
        <DeskUnit key={`desk-${agent.configId}`} x={agent.position.x} y={agent.position.y} />
      ))}
      {/* CEA executive desk in suite */}
      <DeskUnit x={600} y={-40} />

      {/* Meeting table in executive wing */}
      <MeetingTable x={460} y={230} />

      {/* Sofas in corridor rest areas */}
      <Sofa x={300} y={CY + CW / 2} />
      <Sofa x={900} y={CY + CW / 2} flip />

      {/* ─── Layer 7: Decorations ─── */}
      {/* Plants at corridor intersections */}
      <Plant x={CX - 20} y={CY - 20} size={1.2} />
      <Plant x={CX + CW + 20} y={CY - 20} size={1} />
      <Plant x={CX - 20} y={CY + CW + 20} size={1} />
      <Plant x={CX + CW + 20} y={CY + CW + 50} size={1.2} />

      {/* Corner plants */}
      <Plant x={30} y={80} size={0.8} />
      <Plant x={1170} y={50} size={0.8} />
      <Plant x={30} y={660} size={0.8} />
      <Plant x={1170} y={660} size={0.8} />

      {/* Water coolers */}
      <WaterCooler x={CX - 30} y={200} />
      <WaterCooler x={CX + CW + 30} y={520} />

      {/* ─── Layer 7.5: Communication Lines ─── */}
      <CommunicationLines />

      {/* ─── Layer 8: Agent avatars (topmost) ─── */}
      {agentList.map((agent) => (
        <AgentAvatar key={agent.configId} agent={agent} />
      ))}
    </svg>
  );
}
