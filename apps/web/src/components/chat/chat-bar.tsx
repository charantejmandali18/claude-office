'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { AGENT_ROLES } from '@rigelhq/shared';
import { SidebarAvatar } from '../office/agent-avatar';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatBarProps {
  onSend: (message: string, targetAgent?: string) => void;
}

export function ChatBar({ onSend }: ChatBarProps) {
  const messages = useAgentStore((s) => s.messages);
  const [value, setValue] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('cea');
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    if (panelOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, panelOpen]);

  // Open panel when there are new messages
  useEffect(() => {
    if (messages.length > 0) {
      setPanelOpen(true);
    }
  }, [messages.length]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;
      onSend(trimmed, selectedAgent === 'cea' ? undefined : selectedAgent);
      setValue('');
      setPanelOpen(true);
    },
    [value, selectedAgent, onSend],
  );

  const selectedMeta = AGENT_ROLES.find((a) => a.id === selectedAgent);
  const placeholder = selectedAgent === 'cea'
    ? 'Message CEA (orchestrator)...'
    : `Message ${selectedMeta?.name ?? selectedAgent}...`;

  return (
    <div className="relative">
      {/* Messages panel — slides up from bottom */}
      {panelOpen && messages.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-0">
          <div className="mx-4 mb-1 bg-rigel-surface/95 backdrop-blur-sm border border-rigel-border rounded-t-xl shadow-2xl max-h-[300px] flex flex-col overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-rigel-border flex-shrink-0">
              <span className="text-[10px] text-rigel-muted uppercase tracking-wider font-semibold">
                Messages ({messages.length})
              </span>
              <button
                onClick={() => setPanelOpen(false)}
                className="text-rigel-muted hover:text-rigel-text text-xs px-1"
              >
                &times;
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'agent' && msg.agentId && (
                    <div className="flex-shrink-0 mt-0.5">
                      <SidebarAvatar agentId={msg.agentId} size={20} />
                    </div>
                  )}
                  <div className="max-w-[70%]">
                    {msg.sender === 'agent' && msg.agentName && (
                      <span className="text-[10px] text-purple-400 font-medium block">{msg.agentName}</span>
                    )}
                    <div
                      className={`px-2.5 py-1.5 rounded-lg text-xs ${
                        msg.sender === 'user'
                          ? 'bg-rigel-blue text-white rounded-br-sm'
                          : msg.sender === 'system'
                            ? 'bg-rigel-border/50 text-rigel-muted'
                            : 'bg-rigel-bg text-rigel-text border border-rigel-border rounded-bl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[9px] text-rigel-muted mt-0.5 block">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom command bar */}
      <div className="bg-rigel-surface border-t border-rigel-border px-4 py-2">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {/* Agent selector — compact dropdown */}
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="text-xs bg-rigel-bg text-rigel-text border border-rigel-border rounded-lg px-2 py-2 outline-none focus:border-rigel-blue cursor-pointer w-[180px] flex-shrink-0"
          >
            <option value="cea">CEA (Orchestrator)</option>
            {AGENT_ROLES
              .filter((a) => a.id !== 'cea')
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.icon} {agent.name}
                </option>
              ))}
          </select>

          {/* Message input */}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            onFocus={() => { if (messages.length > 0) setPanelOpen(true); }}
            placeholder={placeholder}
            className="flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2 text-sm text-rigel-text placeholder-rigel-muted focus:outline-none focus:border-rigel-blue"
          />

          {/* Toggle messages */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setPanelOpen((prev) => !prev)}
              className="text-rigel-muted hover:text-rigel-text p-2 transition-colors"
              title={panelOpen ? 'Hide messages' : 'Show messages'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* Send */}
          <button
            type="submit"
            disabled={!value.trim()}
            className="px-4 py-2 bg-rigel-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex-shrink-0"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
