import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for Deepgram STT.
 * Browser sends audio chunks via POST, we forward to Deepgram with proper auth headers.
 * Returns transcript JSON.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'STT not configured' }, { status: 500 });
  }

  const audioData = await req.arrayBuffer();
  if (!audioData.byteLength) {
    return NextResponse.json({ error: 'No audio data' }, { status: 400 });
  }

  const params = new URLSearchParams({
    model: 'nova-2',
    punctuate: 'true',
    utterances: 'true',
    smart_format: 'true',
  });

  const resp = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: audioData,
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json(
      { error: 'STT request failed', details: text },
      { status: resp.status },
    );
  }

  const result = await resp.json();
  const transcript =
    result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

  return NextResponse.json({ transcript });
}
