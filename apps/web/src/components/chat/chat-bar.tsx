'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { AGENT_ROLES } from '@rigelhq/shared';
import { SidebarAvatar } from '../office/agent-avatar';
import { voiceConfig } from '@/lib/voice-config';
import { useVoice } from '@/hooks/use-voice';
import { useTts } from '@/hooks/use-tts';
import { VoiceBar } from './voice-bar';
import { MarkdownMessage } from './markdown-message';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatBarProps {
  onSend: (message: string, targetAgent?: string) => void;
  onSummarize: (text: string) => Promise<string>;
}

export function ChatBar({ onSend, onSummarize }: ChatBarProps) {
  const messages = useAgentStore((s) => s.messages);
  const [value, setValue] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('cea');
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Voice state ───────────────────────────────────────────
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ttsAudioCtx, setTtsAudioCtx] = useState<AudioContext | null>(null);
  const lastMsgCountRef = useRef(messages.length);

  const voice = useVoice({
    onTranscript: useCallback(
      (text: string, isFinal: boolean) => {
        setVoiceTranscript(text);
        if (isFinal && text.trim()) {
          onSend(text.trim(), selectedAgent === 'cea' ? undefined : selectedAgent);
          setVoiceTranscript('');
          setPanelOpen(true);
        }
      },
      [onSend, selectedAgent],
    ),
    onError: useCallback((err: string) => {
      setVoiceError(err);
      setIsVoiceMode(false);
    }, []),
  });

  const tts = useTts({
    audioContext: ttsAudioCtx,
  });

  // ── Exit voice mode ────────────────────────────────────────
  const exitVoiceMode = useCallback(() => {
    voice.stop();
    tts.stop();
    if (ttsAudioCtx) {
      ttsAudioCtx.close();
    }
    setTtsAudioCtx(null);
    setIsVoiceMode(false);
    setVoiceTranscript('');
    setVoiceError(null);
  }, [voice, tts, ttsAudioCtx]);

  // ── Enter voice mode ──────────────────────────────────────
  const enterVoiceMode = useCallback(async () => {
    const ctx = new AudioContext();
    setTtsAudioCtx(ctx);
    setIsVoiceMode(true);
    setVoiceError(null);
  }, []);

  // ── Tap mic to speak (while in voice mode) ────────────────
  const tapToSpeak = useCallback(async () => {
    if (voice.isListening || tts.isSpeaking) return; // already busy
    setVoiceTranscript('');
    await voice.start();
  }, [voice, tts.isSpeaking]);

  // ── Welcome message when voice mode activates ─────────────
  useEffect(() => {
    if (isVoiceMode && ttsAudioCtx && voiceConfig.ttsEnabled) {
      const selectedName = selectedAgent === 'cea'
        ? 'the orchestrator'
        : AGENT_ROLES.find((a) => a.id === selectedAgent)?.name ?? selectedAgent;
      tts.speak(`Voice mode active. You're speaking with ${selectedName}. Go ahead.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoiceMode, ttsAudioCtx]);

  // ── Auto-listen after welcome TTS finishes ────────────────
  const hasPlayedWelcome = useRef(false);
  useEffect(() => {
    if (isVoiceMode && !tts.isSpeaking && !voice.isListening && !hasPlayedWelcome.current) {
      hasPlayedWelcome.current = true;
      voice.start();
    }
    if (!isVoiceMode) {
      hasPlayedWelcome.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.isSpeaking, isVoiceMode]);

  // ── TTS trigger for new agent messages ────────────────────
  useEffect(() => {
    if (!isVoiceMode || !voiceConfig.ttsEnabled) return;
    if (messages.length > lastMsgCountRef.current) {
      const newMsg = messages[messages.length - 1];
      if (newMsg.sender === 'agent' && !tts.isSpeaking) {
        // Summarize via CEA's summarizer subagent, then speak
        onSummarize(newMsg.content).then((summary) => {
          tts.speak(summary);
        });
      }
    }
    lastMsgCountRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // ── Existing effects ──────────────────────────────────────
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

  const resetTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  useEffect(() => {
    resetTextareaHeight();
  }, [value, resetTextareaHeight]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const selectedMeta = AGENT_ROLES.find((a) => a.id === selectedAgent);
  const placeholder = selectedAgent === 'cea'
    ? 'Message CEA (orchestrator)...'
    : `Message ${selectedMeta?.name ?? selectedAgent}...`;

  return (
    <div className="flex flex-col h-full">
      {/* Messages panel — inline above input, scrolls within its own container */}
      {panelOpen && messages.length > 0 && (
        <div className="flex-1 min-h-0 bg-rigel-surface/95 backdrop-blur-sm border-t border-rigel-border flex flex-col overflow-hidden">
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
                    <span className="text-[10px] text-purple-400/70 font-medium block">{msg.agentName}</span>
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
                    {msg.sender === 'user' ? msg.content : <MarkdownMessage content={msg.content} />}
                  </div>
                  <span className="text-[9px] text-rigel-muted mt-0.5 block">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom command bar */}
      <div className="bg-rigel-surface border-t border-rigel-border px-4 py-2">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {/* Agent selector — always visible */}
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

          {/* Voice bar OR text input */}
          {isVoiceMode ? (
            <>
              <VoiceBar
                isListening={voice.isListening}
                isSpeaking={tts.isSpeaking}
                transcript={voiceTranscript}
                onStop={exitVoiceMode}
              />

              {/* Tap-to-speak mic button (visible when idle in voice mode) */}
              {!voice.isListening && !tts.isSpeaking && (
                <button
                  type="button"
                  onClick={tapToSpeak}
                  className="flex-shrink-0 p-2 text-green-400 hover:text-green-300 transition-colors"
                  title="Tap to speak"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1Z"
                      stroke="currentColor" strokeWidth="1.3" fill="currentColor" fillOpacity="0.15" />
                    <path d="M4 7v.5a4 4 0 0 0 8 0V7M8 12.5V14M6 14h4"
                      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            <>
              {/* Message input */}
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (messages.length > 0) setPanelOpen(true); }}
                placeholder={placeholder}
                rows={1}
                className="flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2 text-sm text-rigel-text placeholder-rigel-muted focus:outline-none focus:border-rigel-blue resize-none overflow-y-auto"
                style={{ maxHeight: 150 }}
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

              {/* Mic button — enter voice mode */}
              {voiceConfig.enabled && (
                <button
                  type="button"
                  onClick={enterVoiceMode}
                  className="p-2 text-rigel-muted hover:text-rigel-text transition-colors"
                  title="Voice mode"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1Z"
                      stroke="currentColor" strokeWidth="1.3" />
                    <path d="M4 7v.5a4 4 0 0 0 8 0V7M8 12.5V14M6 14h4"
                      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
            </>
          )}
        </form>

        {/* Voice error */}
        {voiceError && (
          <div className="text-[10px] text-red-400 px-1 pt-1">{voiceError}</div>
        )}
      </div>
    </div>
  );
}
