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
