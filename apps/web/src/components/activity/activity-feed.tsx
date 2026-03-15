'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { AgentEvent } from '@rigelhq/shared';

const EVENT_COLORS: Record<string, string> = {
  thinking: 'text-rigel-blue',
  tool: 'text-rigel-yellow',
  speaking: 'text-rigel-green',
  error: 'text-rigel-red',
  lifecycle: 'text-rigel-muted',
};

const EVENT_LABELS: Record<string, string> = {
  thinking: 'THINKING',
  tool: 'TOOL',
  speaking: 'SPEAKING',
  error: 'ERROR',
  lifecycle: 'LIFECYCLE',
};

function classifyEvent(event: AgentEvent): string {
  switch (event.stream) {
    case 'lifecycle':
      if (event.data.phase === 'thinking') return 'thinking';
      return 'lifecycle';
    case 'tool':
      return 'tool';
    case 'assistant':
      return 'speaking';
    case 'error':
      return 'error';
    default:
      return 'lifecycle';
  }
}

function summarizeEvent(event: AgentEvent, eventType: string): string {
  switch (eventType) {
    case 'thinking':
      return 'is thinking...';
    case 'lifecycle':
      if (event.data.phase === 'start') return 'started a run';
      if (event.data.phase === 'end') return 'finished';
      return `lifecycle: ${String(event.data.phase ?? 'unknown')}`;
    case 'tool': {
      const tool = event.data.tool ? String(event.data.tool) : 'unknown';
      if (event.data.phase === 'start') return `using tool: ${tool}`;
      return `finished tool: ${tool}`;
    }
    case 'speaking': {
      const text = event.data.text ? String(event.data.text).slice(0, 120) : '';
      return text || 'speaking...';
    }
    case 'error':
      return String(event.data.error ?? 'Unknown error').slice(0, 120);
    default:
      return JSON.stringify(event.data).slice(0, 80);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ActivityFeed() {
  const events = useAgentStore((s) => s.events);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full bg-rigel-surface border-t border-rigel-border">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rigel-border flex-shrink-0">
        <span className="text-xs font-semibold text-rigel-muted uppercase tracking-wider">
          Activity Feed
        </span>
        <span className="text-xs text-rigel-muted">
          ({events.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs leading-5">
        {events.length === 0 && (
          <div className="text-rigel-muted py-4 text-center">
            No events yet. Waiting for agent activity...
          </div>
        )}
        {events.map((event) => {
          const eventType = classifyEvent(event);
          const colorClass = EVENT_COLORS[eventType] ?? 'text-rigel-muted';
          const label = EVENT_LABELS[eventType] ?? 'EVENT';
          const meta = AGENT_ROLE_MAP.get(event.agentId);
          const icon = meta?.icon ?? '?';
          const name = meta?.name ?? event.agentId;
          const summary = summarizeEvent(event, eventType);

          return (
            <div key={event.id} className="flex items-baseline gap-1.5 truncate">
              <span className="text-rigel-muted flex-shrink-0">
                {formatTime(event.timestamp)}
              </span>
              <span className="flex-shrink-0">{icon}</span>
              <span className="text-rigel-text font-medium flex-shrink-0 max-w-[140px] truncate">
                {name}
              </span>
              <span className={`flex-shrink-0 font-semibold ${colorClass}`}>
                [{label}]
              </span>
              <span className="text-rigel-muted truncate">
                {summary}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
