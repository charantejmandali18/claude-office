# RigelHQ Voice Command Mode — Design Spec

## Goal

Add a voice mode to the command center that lets users speak commands to agents via Deepgram STT, with short spoken acknowledgments from agents via ElevenLabs TTS. Voice mode is a toggle alongside the existing text chat — both coexist.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| STT provider | Deepgram (Nova-2) | Reliable WebSocket streaming, accurate with technical terms, works in all browsers, proper punctuation |
| TTS provider | ElevenLabs | Natural human-like voices, low-latency streaming, distinct voices per agent possible |
| Interaction model | Tap mic to enter voice mode, auto-send on silence (800ms), mic stays active for next utterance | Natural voice assistant feel without manual stop/send per message |
| Agent targeting | Existing dropdown selector (same as text mode) | Already built, reliable. Voice-based name parsing deferred to future iteration |
| TTS response length | Short acknowledgment only (first 1-2 sentences, max ~200 chars) | Full Claude responses can be very long; text panel shows everything |
| UI pattern | Chat bar transforms in-place when voice mode active | Office floor stays visible, agents react in real-time, minimal context switch |

## Architecture

Voice mode is a layer on top of the existing chat system. All messages still flow through the same `onSend` → Socket.io → orchestrator pipeline. Voice changes the input method and adds audio output.

```
Voice Input:
  [Mic] → MediaRecorder (webm/opus) → Deepgram WebSocket → transcript → onSend()

Voice Output:
  Agent response → extract short summary → /api/voice/tts (proxy) → ElevenLabs → audio playback
```

### Audio Capture Strategy

Use `MediaRecorder` with `audio/webm;codecs=opus` (browser default). Do NOT attempt to control sample rate — `MediaRecorder` records in its native format. Deepgram is configured with `encoding=opus` to decode the webm/opus stream server-side. This is the simplest path and avoids `AudioWorklet` complexity.

```typescript
const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
```

The `sampleRate` config (16000) is passed to Deepgram's WebSocket URL as a hint for its decoder, not used by `MediaRecorder`.

### Deepgram WebSocket Authentication

Browser-native `WebSocket` does not support custom headers. Auth is passed via query parameter:

```
wss://api.deepgram.com/v1/listen?token=<DEEPGRAM_API_KEY>&model=nova-2&punctuate=true&utterance_end_ms=800&encoding=opus
```

### Transcript Event Semantics

Deepgram sends two distinct signals:
- **`is_final: true`** on transcript messages — means that audio segment is finalized (but the user may still be mid-sentence)
- **`utterance_end`** event — silence detected, entire utterance is done

The `useVoice` hook accumulates `is_final` transcript segments into a buffer. Only on `utterance_end` does it fire `onTranscript(fullText, true)` and call `onSend`. Interim (non-final) transcripts fire `onTranscript(partialText, false)` for live display only.

### ElevenLabs TTS Proxy

ElevenLabs REST API does not set CORS headers for browser requests. A Next.js API route is required even for local development:

- **Route:** `apps/web/src/app/api/voice/tts/route.ts`
- **Method:** POST
- **Body:** `{ text: string, voiceId: string }`
- **Behavior:** Forwards request to ElevenLabs `POST /v1/text-to-speech/{voice_id}/stream`, streams the mp3 response back to the browser
- Server-side route reads `ELEVENLABS_API_KEY` from non-public env var (no `NEXT_PUBLIC_` prefix needed for this key)

### ElevenLabs Voice ID

ElevenLabs API requires opaque voice IDs, not human-readable names. The `NEXT_PUBLIC_VOICE_TTS_VOICE` env var should contain the actual ElevenLabs voice ID (e.g., `EXAVITQu4vr4xnSDxMaL` for Bella). The API route can optionally look up voice IDs by name via the `/v1/voices` endpoint, but for v1 we use the ID directly.

### AudioContext Lifecycle

Browsers require a user gesture to create/resume an `AudioContext`. The `AudioContext` is created when the user taps the mic button to enter voice mode (a valid user gesture). It is kept alive for the duration of voice mode so that async TTS playback (triggered by agent responses) can play without gesture issues. It is closed when voice mode exits.

### Sequence

1. User taps mic button in chat bar → enters voice mode, creates `AudioContext`
2. `MediaRecorder` starts capturing audio as webm/opus
3. Audio chunks stream to Deepgram via WebSocket (authenticated via `?token=`)
4. Deepgram returns interim transcripts → displayed in voice bar as live text
5. Deepgram fires `utterance_end` after 800ms silence → accumulated final text sent via `onSend(transcript, selectedAgent)`
6. Mic stays active, listening for next utterance
7. When agent responds via Socket.io (existing flow):
   - Full response shown in chat panel as text (unchanged)
   - First 1-2 sentences extracted (max ~200 chars) via `extractShortResponse()` in `lib/voice-utils.ts`
   - `useTts.speak(shortText)` → POST to `/api/voice/tts` → streams mp3 → plays via `AudioContext`
   - Mic pauses during playback (see Mic/TTS Coordination below)
   - Speaker icon pulses during playback
   - Mic resumes after playback completes
8. User taps Stop to exit voice mode → returns to text input, `AudioContext` closed

### Mic/TTS Coordination

To avoid feedback (mic picking up speaker audio), the hooks coordinate via a `paused` flag:

- `chat-bar.tsx` manages `isVoiceMode` state (local to ChatBar, no store needed)
- When `useTts.isSpeaking` becomes true, `chat-bar.tsx` calls `voice.stop()` to pause the MediaRecorder (not exit voice mode)
- When `useTts.isSpeaking` becomes false, `chat-bar.tsx` calls `voice.start()` to resume listening
- This coordination lives in a `useEffect` watching `isSpeaking`

### TTS Trigger Mechanism

Agent messages arrive via `useSocket` → `handleEvent` → `addMessage` to the Zustand store. The `chat-bar.tsx` component detects new agent messages via a `useEffect` that watches `messages.length` with a ref tracking the last seen count. It only triggers TTS when:
- Voice mode is active (`isVoiceMode === true`)
- The new message is from an agent (`sender === 'agent'`)
- TTS is not already speaking

## Component Breakdown

### New Files

#### `apps/web/src/hooks/use-voice.ts`
Core voice hook managing the Deepgram WebSocket connection and MediaRecorder.

**Interface:**
```typescript
function useVoice(options: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  sampleRate?: number;    // default: 16000
  silenceMs?: number;     // default: 800
}): {
  start: () => Promise<void>;
  stop: () => void;
  isListening: boolean;
  error: string | null;
}
```

**Responsibilities:**
- Request microphone permission via `navigator.mediaDevices.getUserMedia`
- Create `MediaRecorder` with `audio/webm;codecs=opus` mimeType
- Open WebSocket to `wss://api.deepgram.com/v1/listen?token=<key>&model=nova-2&punctuate=true&utterance_end_ms=800&encoding=opus`
- Stream audio chunks (`dataavailable` event, 250ms intervals) to Deepgram WebSocket
- Accumulate `is_final` transcript segments into a buffer
- On `utterance_end` event: fire `onTranscript(accumulatedText, true)` and reset buffer
- On interim (non-final) results: fire `onTranscript(partialText, false)` for live display
- On WebSocket close: exit voice mode with error message (no auto-reconnect in v1)
- Clean up MediaRecorder and WebSocket on `stop()` or unmount

#### `apps/web/src/hooks/use-tts.ts`
TTS hook for ElevenLabs audio playback.

**Interface:**
```typescript
function useTts(options?: {
  voiceId?: string;       // default: from NEXT_PUBLIC_VOICE_TTS_VOICE (ElevenLabs voice ID)
  audioContext?: AudioContext;  // shared AudioContext from voice mode
}): {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
}
```

**Responsibilities:**
- POST to local proxy `/api/voice/tts` with `{ text, voiceId }` (avoids CORS)
- Receive streamed mp3 response, decode via shared `AudioContext`
- Expose `isSpeaking` state for UI feedback (speaker icon pulse)
- Cancel current playback on `stop()` or when new speech starts
- Silent failure if API call fails — text response is always available in chat

#### `apps/web/src/app/api/voice/tts/route.ts`
Next.js API route proxying TTS requests to ElevenLabs.

**Responsibilities:**
- Read `ELEVENLABS_API_KEY` from server-side env (no `NEXT_PUBLIC_` prefix)
- Forward POST body `{ text, voiceId }` to `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream`
- Stream mp3 response back to browser with correct `Content-Type: audio/mpeg`
- Return 500 on failure (client handles gracefully)

#### `apps/web/src/lib/voice-utils.ts`
Utility functions for voice processing.

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

#### `apps/web/src/components/chat/voice-bar.tsx`
Voice mode UI that replaces the text input when active.

**Renders:**
- Waveform visualizer (CSS-based audio bars or canvas, animated while listening)
- Status text: "Listening...", "Processing...", interim transcript preview
- Stop button to exit voice mode

**Props:**
```typescript
interface VoiceBarProps {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;       // current interim transcript
  onStop: () => void;
}
```

#### `apps/web/src/lib/voice-config.ts`
Centralized configuration from environment variables.

```typescript
export const voiceConfig = {
  deepgramApiKey: process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ?? '',
  sampleRate: Number(process.env.NEXT_PUBLIC_VOICE_SAMPLE_RATE ?? '16000'),
  silenceMs: Number(process.env.NEXT_PUBLIC_VOICE_VAD_SILENCE_MS ?? '800'),
  ttsVoiceId: process.env.NEXT_PUBLIC_VOICE_TTS_VOICE ?? '',  // ElevenLabs voice ID
  // Enabled only when Deepgram key is configured (TTS is optional — degrades to text-only)
  enabled: Boolean(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY),
  // TTS enabled when both Deepgram and voice ID are configured
  // (ElevenLabs key is server-side only, checked in the API route)
  ttsEnabled: Boolean(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY && process.env.NEXT_PUBLIC_VOICE_TTS_VOICE),
};
```

### Modified Files

#### `apps/web/src/components/chat/chat-bar.tsx`
- Add `isVoiceMode` state toggle
- Add mic button next to Send button (hidden if `voiceConfig.enabled` is false)
- When `isVoiceMode` is true, render `<VoiceBar>` instead of `<input>`
- Wire `useVoice` hook: on final transcript, call `onSend(transcript, selectedAgent)`
- Wire `useTts` hook: on new agent message, extract short summary and speak it
- Add speaker icon that pulses when `isSpeaking` is true

#### `apps/web/.env.local` (new, gitignored)
```
# Client-side (exposed to browser)
NEXT_PUBLIC_DEEPGRAM_API_KEY=<deepgram-key>
NEXT_PUBLIC_VOICE_TTS_VOICE=<elevenlabs-voice-id>
NEXT_PUBLIC_VOICE_VAD_SILENCE_MS=800
NEXT_PUBLIC_VOICE_SAMPLE_RATE=16000

# Server-side only (used by /api/voice/tts route)
ELEVENLABS_API_KEY=<elevenlabs-key>
```

### Unchanged Files
- `hooks/use-socket.ts` — `onSend` pipeline unchanged
- `store/agent-store.ts` — messages flow through existing store
- `components/office/` — office floor, avatars, sidebar untouched

## UI States

### Text Mode (default — current behavior)
```
[ Agent Selector ▾ ] [ Message CEA (orchestrator)...          ] [🎤] [ Send ]
```
Mic button appears if API keys are configured. Everything else unchanged.

### Voice Mode (active)
```
[ Agent Selector ▾ ] [ 🔴 Listening... ~~~waveform~~~ "build an auth..." ] [ ■ Stop ]
```
- Text input replaced by voice bar with waveform + live transcript
- Agent selector stays the same
- Send button replaced by Stop button
- Slide-up message panel shows all messages as text (unchanged)

### Voice Mode (agent speaking)
```
[ Agent Selector ▾ ] [ 🔊 Speaking... ~~~waveform~~~ ] [ ■ Stop ]
```
- Mic pauses while agent audio plays to avoid feedback
- Speaker icon pulses
- Resumes listening after playback completes

## Short Response Extraction

Defined in `apps/web/src/lib/voice-utils.ts`. Takes the first two sentences or 200 characters, whichever is shorter. Used by `chat-bar.tsx` to truncate agent responses before passing to `useTts.speak()`.

## Error Handling

| Error | Behavior |
|-------|----------|
| Mic permission denied | Show "Microphone access required" in voice bar, exit voice mode |
| Deepgram WebSocket drops | Exit voice mode with "Connection lost" error message. User can re-enter voice mode manually. (Auto-reconnect deferred to future iteration) |
| ElevenLabs API fails | Silent failure — full text still shows in chat panel. No audio is acceptable, missing text is not |
| No speech detected | Mic stays active until user taps Stop. (Inactivity timeout deferred to future iteration) |
| Browser lacks MediaRecorder | Hide mic button entirely (graceful degradation) |
| API keys not configured | Hide mic button entirely |

## Security

- **Deepgram API key** exposed to browser via `NEXT_PUBLIC_DEEPGRAM_API_KEY` (required for direct WebSocket connection). Acceptable for localhost; for production, use Deepgram's temporary auth token endpoint.
- **ElevenLabs API key** is server-side only (`ELEVENLABS_API_KEY`, no `NEXT_PUBLIC_` prefix). Browser calls `/api/voice/tts` proxy route — key never reaches the client.
- All env vars stored in `.env.local` (gitignored by Next.js default).

## Environment Configuration

| Variable | Scope | Value | Purpose |
|----------|-------|-------|---------|
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Client | (from .env.local) | Deepgram STT WebSocket auth via `?token=` |
| `ELEVENLABS_API_KEY` | Server | (from .env.local) | ElevenLabs TTS auth (used by API route only) |
| `NEXT_PUBLIC_VOICE_TTS_VOICE` | Client | ElevenLabs voice ID | Voice selection for TTS playback |
| `NEXT_PUBLIC_VOICE_VAD_SILENCE_MS` | Client | `800` | Silence duration before utterance end |
| `NEXT_PUBLIC_VOICE_SAMPLE_RATE` | Client | `16000` | Deepgram decoder sample rate hint |

## Dependencies

| Package | Purpose |
|---------|---------|
| None new | Deepgram uses raw WebSocket (browser native). ElevenLabs uses fetch + Web Audio API. No SDK dependencies needed. |

## Out of Scope (future iterations)

- Voice-based agent targeting ("Backend Engineer, build an API")
- Per-agent distinct voices (assigning different ElevenLabs voices to each agent)
- Wake word detection ("Hey Rigel")
- Push-to-talk alternative mode
- Production API key proxy
- Whisper fallback for non-Deepgram scenarios
- Inactivity timeout (auto-exit voice mode after N seconds of silence)
- Deepgram WebSocket auto-reconnect on disconnect
