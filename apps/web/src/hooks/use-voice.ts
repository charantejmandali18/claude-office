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
      setIsListening(false);
    };
  }, [sampleRate, silenceMs, stop]);

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
