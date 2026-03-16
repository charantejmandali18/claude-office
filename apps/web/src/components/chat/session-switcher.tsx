'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAgentStore } from '@/store/agent-store';
import type { SessionStatus } from '@rigelhq/shared';
const STATUS_DOT_COLORS: Record<SessionStatus, string> = {
  active: '#22c55e',  // green
  idle: '#eab308',    // yellow
  stopped: '#6b7280', // gray
};

interface SessionTab {
  id: string;
  projectName: string;
  status: SessionStatus;
}

interface SessionSwitcherProps {
  onSwitch?: (sessionId: string) => void;
  onCreate?: (projectName: string) => void;
}

export function SessionSwitcher({ onSwitch, onCreate }: SessionSwitcherProps) {
  const sessionsMap = useAgentStore((s) => s.sessions);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);

  const sessions = useMemo<SessionTab[]>(() => {
    if (!sessionsMap) return [];
    return Array.from(sessionsMap.entries()).map(([id, s]) => ({
      id,
      projectName: s.projectName,
      status: s.status as SessionStatus,
    }));
  }, [sessionsMap]);

  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const handleSwitch = useCallback((sessionId: string) => {
    if (sessionId === activeSessionId) return;
    onSwitch?.(sessionId);
  }, [activeSessionId, onSwitch]);

  const handleCreateStart = useCallback(() => {
    setIsCreating(true);
    setNewProjectName('');
  }, []);

  const handleCreateSubmit = useCallback(() => {
    const name = newProjectName.trim();
    if (!name) return;
    onCreate?.(name);
    setIsCreating(false);
    setNewProjectName('');
  }, [newProjectName, onCreate]);

  const handleCreateCancel = useCallback(() => {
    setIsCreating(false);
    setNewProjectName('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateSubmit();
    } else if (e.key === 'Escape') {
      handleCreateCancel();
    }
  }, [handleCreateSubmit, handleCreateCancel]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-rigel-bg border-b border-rigel-border overflow-x-auto scrollbar-none">
      {/* Session tabs */}
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        return (
          <button
            key={session.id}
            onClick={() => handleSwitch(session.id)}
            className={`
              flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium
              whitespace-nowrap transition-colors duration-150
              ${isActive
                ? 'bg-rigel-surface text-rigel-text border border-rigel-border'
                : 'text-rigel-muted hover:text-rigel-text hover:bg-rigel-surface/50'
              }
            `}
          >
            {/* Status dot */}
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: STATUS_DOT_COLORS[session.status] }}
            />
            {session.projectName}
          </button>
        );
      })}

      {/* Create new session */}
      {isCreating ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleCreateCancel}
            placeholder="Project name..."
            autoFocus
            className="
              w-32 px-2 py-1 rounded-md text-xs
              bg-rigel-surface text-rigel-text border border-rigel-purple/50
              placeholder:text-rigel-muted
              focus:outline-none focus:ring-1 focus:ring-rigel-purple/50
            "
          />
        </div>
      ) : (
        <button
          onClick={handleCreateStart}
          className="
            flex items-center justify-center w-6 h-6 rounded-md
            text-rigel-muted hover:text-rigel-text hover:bg-rigel-surface/50
            transition-colors duration-150 flex-shrink-0
          "
          title="New session"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
