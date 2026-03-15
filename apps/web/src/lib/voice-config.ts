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
