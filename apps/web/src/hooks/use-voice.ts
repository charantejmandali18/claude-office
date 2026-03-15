'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceConfig } from '@/lib/voice-config';

interface UseVoiceOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  silenceMs?: number;
}

/**
 * Voice input hook using MediaRecorder + server-side Deepgram proxy.
 *
 * Records audio via MediaRecorder, monitors volume for silence detection,
 * and sends completed audio chunks to /api/voice/stt for transcription.
 */
export function useVoice({
  onTranscript,
  onError,
  silenceMs = voiceConfig.silenceMs,
}: UseVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onTranscript, onError });
  const isListeningRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = { onTranscript, onError };
  }, [onTranscript, onError]);

  const sendAudioForTranscription = useCallback(async (blob: Blob) => {
    if (blob.size < 5000) return; // skip tiny/silent clips that Deepgram can't decode

    callbacksRef.current.onTranscript('Processing...', false);

    try {
      const resp = await fetch('/api/voice/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/webm' },
        body: blob,
      });

      if (!resp.ok) {
        console.error('STT proxy error:', resp.status);
        return;
      }

      const { transcript } = await resp.json();
      if (transcript && transcript.trim()) {
        callbacksRef.current.onTranscript(transcript.trim(), true);
      } else {
        callbacksRef.current.onTranscript('', false);
      }
    } catch (err) {
      console.error('STT fetch error:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !isListeningRef.current) return;

    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      chunksRef.current = [];

      if (blob.size > 5000) {
        await sendAudioForTranscription(blob);
      }

      // Auto-restart recording if still in voice mode
      if (isListeningRef.current && streamRef.current) {
        startRecording();
      }
    };

    recorder.start(250); // collect chunks every 250ms

    // Silence detection via AnalyserNode
    const analyser = analyserRef.current;
    if (analyser) {
      const dataArray = new Uint8Array(analyser.fftSize);
      let speaking = false;

      const checkVolume = () => {
        if (!isListeningRef.current) return;

        analyser.getByteTimeDomainData(dataArray);

        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const isSpeakingNow = rms > 0.02; // threshold

        if (isSpeakingNow) {
          speaking = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speaking && !silenceTimerRef.current) {
          // Silence after speech — start timer
          silenceTimerRef.current = setTimeout(() => {
            speaking = false;
            silenceTimerRef.current = null;
            // Stop recording to trigger transcription
            stopRecording();
          }, silenceMs);
        }

        rafRef.current = requestAnimationFrame(checkVolume);
      };

      rafRef.current = requestAnimationFrame(checkVolume);
    }
  }, [silenceMs, sendAudioForTranscription, stopRecording]);

  const stop = useCallback(() => {
    isListeningRef.current = false;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    // Get mic permission
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

    // Set up audio analysis for silence detection
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    isListeningRef.current = true;
    setIsListening(true);

    // Start the first recording
    startRecording();
  }, [startRecording]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return { start, stop, isListening, error };
}
