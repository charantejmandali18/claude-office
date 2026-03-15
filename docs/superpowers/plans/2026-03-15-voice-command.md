# Voice Command Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice input (Deepgram STT) and audio output (ElevenLabs TTS) to the command center chat bar, letting users speak commands and hear short agent responses.

**Architecture:** Voice mode is a layer on top of existing chat. All messages still flow through `onSend` → Socket.io → orchestrator. Voice changes input method (mic → Deepgram WebSocket → transcript → onSend) and adds audio output (agent response → extract short summary → ElevenLabs TTS proxy → AudioContext playback). Mic pauses during TTS to prevent feedback.

**Tech Stack:** Deepgram Nova-2 (WebSocket streaming STT), ElevenLabs (REST TTS via Next.js proxy), Web Audio API, MediaRecorder (webm/opus), Next.js API routes.

**Spec:** `docs/superpowers/specs/2026-03-15-voice-command-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/web/.env.local` | Create | Environment variables for Deepgram + ElevenLabs |
| `apps/web/src/lib/voice-config.ts` | Create | Centralized env var config with enabled/disabled flags |
| `apps/web/src/lib/voice-utils.ts` | Create | `extractShortResponse()` utility for TTS truncation |
| `apps/web/src/app/api/voice/tts/route.ts` | Create | Next.js API route proxying TTS to ElevenLabs (CORS) |
| `apps/web/src/hooks/use-voice.ts` | Create | Deepgram WebSocket + MediaRecorder hook |
| `apps/web/src/hooks/use-tts.ts` | Create | ElevenLabs TTS playback hook |
| `apps/web/src/components/chat/voice-bar.tsx` | Create | Voice mode UI (waveform, status, transcript, stop) |
| `apps/web/src/components/chat/chat-bar.tsx` | Modify | Add mic toggle, voice/TTS hooks, voice bar swap |

---

## Chunk 1: Foundation (config, utils, env)

### Task 1: Environment Variables

**Files:**
- Create: `apps/web/.env.local`

- [ ] **Step 1: Create .env.local**

```bash
# Client-side (exposed to browser)
NEXT_PUBLIC_DEEPGRAM_API_KEY=5d369e9d69a02b71844843935040e6fb8621b5de
NEXT_PUBLIC_VOICE_TTS_VOICE=EXAVITQu4vr4xnSDxMaL
NEXT_PUBLIC_VOICE_VAD_SILENCE_MS=800
NEXT_PUBLIC_VOICE_SAMPLE_RATE=16000

# Server-side only (used by /api/voice/tts route)
ELEVENLABS_API_KEY=sk_6357f09470bdc557868f914685f6d8cd367426660a05b056
```

Note: `NEXT_PUBLIC_VOICE_TTS_VOICE` uses ElevenLabs voice ID for "Bella" (`EXAVITQu4vr4xnSDxMaL`). The user provided `bella` as string — this is the actual ID.

- [ ] **Step 2: Verify .env.local is gitignored**

Run: `grep '.env.local' apps/web/.gitignore`
Expected: `.env.local` appears in gitignore (Next.js default)

---

### Task 2: Voice Config

**Files:**
- Create: `apps/web/src/lib/voice-config.ts`

- [ ] **Step 1: Create voice-config.ts**

```typescript
export const voiceConfig = {
  deepgramApiKey: process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ?? '',
  sampleRate: Number(process.env.NEXT_PUBLIC_VOICE_SAMPLE_RATE ?? '16000'),
  silenceMs: Number(process.env.NEXT_PUBLIC_VOICE_VAD_SILENCE_MS ?? '800'),
  ttsVoiceId: process.env.NEXT_PUBLIC_VOICE_TTS_VOICE ?? '',
  enabled: Boolean(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY),
  ttsEnabled: Boolean(
    process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY &&
    process.env.NEXT_PUBLIC_VOICE_TTS_VOICE
  ),
};
```

---

### Task 3: Voice Utils

**Files:**
- Create: `apps/web/src/lib/voice-utils.ts`

- [ ] **Step 1: Create voice-utils.ts**

```typescript
export function extractShortResponse(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 1) {
    const short = sentences.slice(0, 2).join(' ').trim();
    return short.length <= 200 ? short : short.slice(0, 197) + '...';
  }
  return text.slice(0, 200);
}
```

---

## Chunk 2: TTS Proxy API Route

### Task 4: ElevenLabs TTS Proxy

**Files:**
- Create: `apps/web/src/app/api/voice/tts/route.ts`

- [ ] **Step 1: Create directory**

Run: `mkdir -p apps/web/src/app/api/voice/tts`

- [ ] **Step 2: Create route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TTS not configured' }, { status: 500 });
  }

  const { text, voiceId } = await req.json();
  if (!text || !voiceId) {
    return NextResponse.json({ error: 'Missing text or voiceId' }, { status: 400 });
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!resp.ok) {
    return NextResponse.json(
      { error: 'TTS request failed' },
      { status: resp.status },
    );
  }

  return new NextResponse(resp.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
```

---

## Chunk 3: Hooks (use-voice, use-tts)

### Task 5: useVoice Hook (Deepgram STT)

**Files:**
- Create: `apps/web/src/hooks/use-voice.ts`

- [ ] **Step 1: Create use-voice.ts**

```typescript
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceConfig } from '@/lib/voice-config';

interface UseVoiceOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  sampleRate?: number;
  silenceMs?: number;
}

export function useVoice({
  onTranscript,
  onError,
  sampleRate = voiceConfig.sampleRate,
  silenceMs = voiceConfig.silenceMs,
}: UseVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<string>('');
  const callbacksRef = useRef({ onTranscript, onError });

  // Keep callbacks fresh without causing re-renders
  useEffect(() => {
    callbacksRef.current = { onTranscript, onError };
  }, [onTranscript, onError]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    bufferRef.current = '';
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    // 1. Get mic permission
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      const msg = 'Microphone access required';
      setError(msg);
      callbacksRef.current.onError(msg);
      return;
    }
    streamRef.current = stream;

    // 2. Open Deepgram WebSocket
    const params = new URLSearchParams({
      token: voiceConfig.deepgramApiKey,
      model: 'nova-2',
      punctuate: 'true',
      utterance_end_ms: String(silenceMs),
      encoding: 'opus',
      sample_rate: String(sampleRate),
    });

    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      // 3. Start MediaRecorder once WebSocket is open
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorder.start(250); // send chunks every 250ms
      setIsListening(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // utterance_end event → fire final transcript
      if (data.type === 'UtteranceEnd') {
        if (bufferRef.current.trim()) {
          callbacksRef.current.onTranscript(bufferRef.current.trim(), true);
          bufferRef.current = '';
        }
        return;
      }

      // Transcript event
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      if (data.is_final) {
        bufferRef.current += (bufferRef.current ? ' ' : '') + transcript;
        // Show accumulated text as interim for live display
        callbacksRef.current.onTranscript(bufferRef.current, false);
      } else {
        // Interim: show buffer + current partial
        const preview = bufferRef.current
          ? bufferRef.current + ' ' + transcript
          : transcript;
        callbacksRef.current.onTranscript(preview, false);
      }
    };

    ws.onerror = () => {
      const msg = 'Voice connection error';
      setError(msg);
      callbacksRef.current.onError(msg);
      stop();
    };

    ws.onclose = () => {
      if (isListening) {
        stop();
      }
    };
  }, [sampleRate, silenceMs, stop, isListening]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return { start, stop, isListening, error };
}
```

---

### Task 6: useTts Hook (ElevenLabs TTS)

**Files:**
- Create: `apps/web/src/hooks/use-tts.ts`

- [ ] **Step 1: Create use-tts.ts**

```typescript
'use client';

import { useState, useRef, useCallback } from 'react';
import { voiceConfig } from '@/lib/voice-config';

interface UseTtsOptions {
  voiceId?: string;
  audioContext?: AudioContext | null;
}

export function useTts({
  voiceId = voiceConfig.ttsVoiceId,
  audioContext,
}: UseTtsOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceId || !audioContext) return;

      // Stop any current playback
      stopPlayback();

      try {
        const resp = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId }),
        });

        if (!resp.ok) return; // silent failure — text is in chat

        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        sourceRef.current = source;

        setIsSpeaking(true);
        source.onended = () => {
          sourceRef.current = null;
          setIsSpeaking(false);
        };
        source.start();
      } catch {
        // Silent failure — full text always available in chat panel
        setIsSpeaking(false);
      }
    },
    [voiceId, audioContext, stopPlayback],
  );

  return { speak, stop: stopPlayback, isSpeaking };
}
```

---

## Chunk 4: Voice Bar UI Component

### Task 7: VoiceBar Component

**Files:**
- Create: `apps/web/src/components/chat/voice-bar.tsx`

- [ ] **Step 1: Create voice-bar.tsx**

```typescript
'use client';

interface VoiceBarProps {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  onStop: () => void;
}

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-150 ${
            active
              ? 'bg-red-400 animate-pulse'
              : 'bg-rigel-muted'
          }`}
          style={{
            height: active ? `${8 + Math.sin(i * 1.2) * 8}px` : '4px',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function VoiceBar({
  isListening,
  isSpeaking,
  transcript,
  onStop,
}: VoiceBarProps) {
  const statusText = isSpeaking
    ? 'Speaking...'
    : isListening
      ? 'Listening...'
      : 'Paused';

  const statusColor = isSpeaking
    ? 'text-purple-400'
    : isListening
      ? 'text-red-400'
      : 'text-rigel-muted';

  return (
    <div className="flex items-center gap-3 flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2">
      {/* Status indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isSpeaking
              ? 'bg-purple-500 animate-pulse'
              : isListening
                ? 'bg-red-500 animate-pulse'
                : 'bg-gray-500'
          }`}
        />
        <span className={`text-xs font-medium ${statusColor}`}>
          {statusText}
        </span>
      </div>

      {/* Waveform */}
      <WaveformBars active={isListening || isSpeaking} />

      {/* Transcript preview */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-rigel-text truncate">
          {transcript || (isListening ? 'Say something...' : '')}
        </p>
      </div>

      {/* Stop button */}
      <button
        type="button"
        onClick={onStop}
        className="flex-shrink-0 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
      >
        &#9632; Stop
      </button>
    </div>
  );
}
```

---

## Chunk 5: Chat Bar Integration

### Task 8: Wire Voice Mode into ChatBar

**Files:**
- Modify: `apps/web/src/components/chat/chat-bar.tsx`

- [ ] **Step 1: Add imports for voice hooks, components, and config**

Add at top of file after existing imports:
```typescript
import { voiceConfig } from '@/lib/voice-config';
import { extractShortResponse } from '@/lib/voice-utils';
import { useVoice } from '@/hooks/use-voice';
import { useTts } from '@/hooks/use-tts';
import { VoiceBar } from './voice-bar';
```

- [ ] **Step 2: Add voice state and hooks inside ChatBar component**

After existing state declarations (`panelOpen`, `inputRef`), add:
```typescript
const [isVoiceMode, setIsVoiceMode] = useState(false);
const [voiceTranscript, setVoiceTranscript] = useState('');
const [voiceError, setVoiceError] = useState<string | null>(null);
const audioCtxRef = useRef<AudioContext | null>(null);
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
  audioContext: audioCtxRef.current,
});
```

- [ ] **Step 3: Add mic toggle handler**

```typescript
const toggleVoiceMode = useCallback(async () => {
  if (isVoiceMode) {
    // Exit voice mode
    voice.stop();
    tts.stop();
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsVoiceMode(false);
    setVoiceTranscript('');
    setVoiceError(null);
  } else {
    // Enter voice mode — AudioContext needs user gesture
    audioCtxRef.current = new AudioContext();
    setIsVoiceMode(true);
    setVoiceError(null);
    await voice.start();
  }
}, [isVoiceMode, voice, tts]);
```

- [ ] **Step 4: Add mic/TTS coordination effect**

```typescript
// Pause mic during TTS playback to avoid feedback
useEffect(() => {
  if (!isVoiceMode) return;
  if (tts.isSpeaking) {
    voice.stop();
  } else if (isVoiceMode && !tts.isSpeaking) {
    voice.start();
  }
}, [tts.isSpeaking, isVoiceMode, voice]);
```

- [ ] **Step 5: Add TTS trigger effect for new agent messages**

```typescript
// Speak short summary of new agent messages while in voice mode
useEffect(() => {
  if (!isVoiceMode || !voiceConfig.ttsEnabled) return;
  if (messages.length > lastMsgCountRef.current) {
    const newMsg = messages[messages.length - 1];
    if (newMsg.sender === 'agent' && !tts.isSpeaking) {
      const short = extractShortResponse(newMsg.content);
      tts.speak(short);
    }
  }
  lastMsgCountRef.current = messages.length;
}, [messages.length, isVoiceMode, tts]);
```

- [ ] **Step 6: Update JSX — add mic button and voice bar swap**

In the form, between the `input` and the toggle-messages button, replace the input conditionally with VoiceBar when in voice mode. Add mic button next to Send.

The updated form section:
```tsx
<form onSubmit={handleSubmit} className="flex items-center gap-2">
  {/* Agent selector — unchanged */}
  <select ...>...</select>

  {/* Voice bar OR text input */}
  {isVoiceMode ? (
    <VoiceBar
      isListening={voice.isListening}
      isSpeaking={tts.isSpeaking}
      transcript={voiceTranscript}
      onStop={toggleVoiceMode}
    />
  ) : (
    <>
      <input ... />

      {/* Toggle messages */}
      {messages.length > 0 && (
        <button type="button" onClick={...}>...</button>
      )}

      {/* Mic button */}
      {voiceConfig.enabled && (
        <button
          type="button"
          onClick={toggleVoiceMode}
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
      <button type="submit" ...>Send</button>
    </>
  )}
</form>
```

- [ ] **Step 7: Show voice error**

Below the form, add:
```tsx
{voiceError && (
  <div className="text-[10px] text-red-400 px-4 pb-1">{voiceError}</div>
)}
```

- [ ] **Step 8: Verify build compiles**

Run: `cd apps/web && npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds (or only lint warnings)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/voice-config.ts apps/web/src/lib/voice-utils.ts \
  apps/web/src/hooks/use-voice.ts apps/web/src/hooks/use-tts.ts \
  apps/web/src/app/api/voice/tts/route.ts \
  apps/web/src/components/chat/voice-bar.tsx \
  apps/web/src/components/chat/chat-bar.tsx
git commit -m "feat: add voice command mode with Deepgram STT and ElevenLabs TTS"
```
