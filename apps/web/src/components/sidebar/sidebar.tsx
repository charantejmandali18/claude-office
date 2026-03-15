'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { useAgentStore, type AgentState } from '@/store/agent-store';
import { AGENT_ROLES, AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { AgentEvent } from '@rigelhq/shared';
import { SidebarAvatar } from '../office/agent-avatar';

// ── Icons ────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
      className={`transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-rigel-muted">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── Status helpers ────────────────────────────────────────────

const STATUS_DOT_COLORS: Record<string, string> = {
  OFFLINE: 'bg-gray-500',
  IDLE: 'bg-green-500',
  THINKING: 'bg-blue-500',
  TOOL_CALLING: 'bg-orange-500',
  SPEAKING: 'bg-purple-500',
  COLLABORATING: 'bg-cyan-500',
  ERROR: 'bg-red-500',
};

function statusLabel(status: string): string {
  switch (status) {
    case 'OFFLINE': return 'Offline';
    case 'IDLE': return 'Idle';
    case 'THINKING': return 'Thinking';
    case 'TOOL_CALLING': return 'Using tool';
    case 'SPEAKING': return 'Speaking';
    case 'COLLABORATING': return 'Collaborating';
    case 'ERROR': return 'Error';
    default: return status;
  }
}

type TabFilter = 'all' | 'active' | 'idle' | 'error';

function matchesTab(agent: AgentState, tab: TabFilter): boolean {
  switch (tab) {
    case 'all': return true;
    case 'active': return !['OFFLINE', 'IDLE'].includes(agent.status);
    case 'idle': return agent.status === 'IDLE' || agent.status === 'OFFLINE';
    case 'error': return agent.status === 'ERROR';
  }
}

// ── Collapsible section ──────────────────────────────────────

function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-rigel-border">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-rigel-muted uppercase tracking-wider hover:bg-rigel-bg/50 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <ChevronIcon open={open} />
          <span>{title}</span>
        </div>
        {badge !== undefined && (
          <span className="text-[10px] font-medium text-rigel-text bg-rigel-bg px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Metrics panel ────────────────────────────────────────────

function MetricsPanel() {
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);

  const stats = useMemo(() => {
    const list = [...agents.values()];
    return {
      total: list.length,
      active: list.filter((a) => !['OFFLINE'].includes(a.status)).length,
      thinking: list.filter((a) => a.status === 'THINKING').length,
      toolCalling: list.filter((a) => a.status === 'TOOL_CALLING').length,
      errors: list.filter((a) => a.status === 'ERROR').length,
    };
  }, [agents]);

  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2">
      <MetricCard label="Active" value={stats.active} total={stats.total} color="text-green-400" />
      <MetricCard label="Thinking" value={stats.thinking} color="text-blue-400" />
      <MetricCard label="Errors" value={stats.errors} color={stats.errors > 0 ? 'text-red-400' : 'text-rigel-muted'} />
      <div className="col-span-3 flex items-center gap-1.5 mt-1">
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] text-rigel-muted">
          {connected ? 'Connected to orchestrator' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, total, color }: {
  label: string; value: number; total?: number; color: string;
}) {
  return (
    <div className="bg-rigel-bg/60 rounded px-2 py-1.5">
      <div className={`text-base font-bold ${color}`}>
        {value}{total !== undefined && <span className="text-xs text-rigel-muted font-normal">/{total}</span>}
      </div>
      <div className="text-[10px] text-rigel-muted">{label}</div>
    </div>
  );
}

// ── Agent list ───────────────────────────────────────────────

function AgentList() {
  const agents = useAgentStore((s) => s.agents);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabFilter>('all');

  const filtered = useMemo(() => {
    return [...agents.values()]
      .filter((a) => matchesTab(a, tab))
      .filter((a) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        // Active agents first, then alphabetical
        const aActive = a.status !== 'OFFLINE' ? 0 : 1;
        const bActive = b.status !== 'OFFLINE' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.name.localeCompare(b.name);
      });
  }, [agents, search, tab]);

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'idle', label: 'Idle' },
    { key: 'error', label: 'Error' },
  ];

  return (
    <div>
      {/* Search */}
      <div className="px-3 py-1.5">
        <div className="flex items-center gap-1.5 bg-rigel-bg rounded px-2 py-1">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-xs text-rigel-text placeholder:text-rigel-muted outline-none flex-1"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 px-3 py-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              tab === t.key
                ? 'bg-rigel-blue/20 text-rigel-blue font-medium'
                : 'text-rigel-muted hover:text-rigel-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Agent rows */}
      <div className="max-h-[280px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-[10px] text-rigel-muted text-center py-4">No agents match</div>
        )}
        {filtered.map((agent) => (
          <AgentRow key={agent.configId} agent={agent} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentState }) {
  const dotColor = STATUS_DOT_COLORS[agent.status] ?? 'bg-gray-500';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-rigel-bg/40 transition-colors cursor-default">
      <SidebarAvatar agentId={agent.configId} size={24} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-rigel-text truncate">{agent.name}</div>
        <div className="text-[10px] text-rigel-muted truncate">{agent.role}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className="text-[10px] text-rigel-muted">{statusLabel(agent.status)}</span>
      </div>
    </div>
  );
}

// ── Event timeline ───────────────────────────────────────────

const STREAM_COLORS: Record<string, string> = {
  lifecycle: 'border-gray-500',
  tool: 'border-orange-500',
  assistant: 'border-purple-500',
  error: 'border-red-500',
};

const STREAM_TEXT_COLORS: Record<string, string> = {
  lifecycle: 'text-rigel-muted',
  tool: 'text-orange-400',
  assistant: 'text-purple-400',
  error: 'text-red-400',
};

function summarizeEvent(event: AgentEvent): string {
  switch (event.stream) {
    case 'lifecycle':
      return event.data.phase === 'start' ? 'started' :
             event.data.phase === 'end' ? 'finished' :
             event.data.phase === 'thinking' ? 'thinking...' :
             `${String(event.data.phase ?? 'unknown')}`;
    case 'tool': {
      const tool = event.data.tool ? String(event.data.tool) : 'unknown';
      return event.data.phase === 'start' ? `→ ${tool}` : `✓ ${tool}`;
    }
    case 'assistant':
      return String(event.data.text ?? '').slice(0, 60) || 'speaking...';
    case 'error':
      return String(event.data.error ?? 'Error').slice(0, 60);
    default:
      return JSON.stringify(event.data).slice(0, 40);
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function EventTimeline() {
  const events = useAgentStore((s) => s.events);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const recent = events.slice(-30);

  return (
    <div className="max-h-[200px] overflow-y-auto px-3 py-1">
      {recent.length === 0 && (
        <div className="text-[10px] text-rigel-muted text-center py-4">
          Waiting for agent activity...
        </div>
      )}
      {recent.map((event) => {
        const meta = AGENT_ROLE_MAP.get(event.agentId);
        const borderColor = STREAM_COLORS[event.stream] ?? 'border-gray-500';
        const textColor = STREAM_TEXT_COLORS[event.stream] ?? 'text-rigel-muted';

        return (
          <div key={event.id} className={`flex items-start gap-2 py-1 border-l-2 pl-2 ${borderColor}`}>
            <span className="text-[10px] text-rigel-muted flex-shrink-0 w-[52px]">
              {formatTime(event.timestamp)}
            </span>
            <div className="min-w-0">
              <span className="text-[10px] text-rigel-text font-medium">
                {meta?.name ?? event.agentId}
              </span>
              <span className={`text-[10px] ml-1 ${textColor}`}>
                {summarizeEvent(event)}
              </span>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Main sidebar ─────────────────────────────────────────────

export function Sidebar() {
  const agents = useAgentStore((s) => s.agents);
  const events = useAgentStore((s) => s.events);

  const activeCount = useMemo(() => {
    return [...agents.values()].filter((a) => a.status !== 'OFFLINE').length;
  }, [agents]);

  return (
    <div className="flex flex-col h-full bg-rigel-surface border-l border-rigel-border">
      {/* Sidebar header */}
      <div className="px-3 py-2.5 border-b border-rigel-border">
        <div className="flex items-center gap-2">
          <span className="text-base">⬡</span>
          <span className="text-sm font-bold text-rigel-blue tracking-tight">RigelHQ</span>
          <span className="text-[10px] text-rigel-muted">Command Center</span>
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">
        <Section title="Metrics" defaultOpen={true}>
          <MetricsPanel />
        </Section>

        <Section title="Agents" badge={`${activeCount}/${agents.size}`} defaultOpen={true}>
          <AgentList />
        </Section>

        <Section title="Activity" badge={events.length} defaultOpen={true}>
          <EventTimeline />
        </Section>
      </div>
    </div>
  );
}
