import { getApiKey } from '../env.js';

const XAI_BASE = 'https://api.x.ai/v1';

export interface XaiVoice {
  voice_id: string;
  name: string;
  description?: string;
}

export const DEFAULT_VOICES: XaiVoice[] = [
  { voice_id: 'eve', name: 'Eve', description: 'Default — warm and natural' },
  { voice_id: 'ara', name: 'Ara', description: 'Clear and professional' },
  { voice_id: 'rex', name: 'Rex', description: 'Deep and confident' },
  { voice_id: 'sal', name: 'Sal', description: 'Friendly and upbeat' },
  { voice_id: 'leo', name: 'Leo', description: 'Calm and measured' },
];

export async function synthesizeSpeech(params: {
  text: string;
  voiceId?: string;
  language?: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('XAI_API_KEY is not configured');

  const response = await fetch(`${XAI_BASE}/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: params.text.slice(0, 15_000),
      voice_id: params.voiceId ?? 'eve',
      language: params.language ?? 'en',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`xAI TTS failed (${response.status}): ${detail}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'audio/mpeg';
  return { buffer, contentType };
}

export async function transcribeAudio(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('XAI_API_KEY is not configured');

  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.buffer)], { type: params.mimeType });
  form.append('file', blob, params.filename);

  const response = await fetch(`${XAI_BASE}/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`xAI STT failed (${response.status}): ${detail}`);
  }

  const result = await response.json() as { text?: string };
  return result.text?.trim() ?? '';
}

export async function listVoices(): Promise<XaiVoice[]> {
  const apiKey = getApiKey();
  if (!apiKey) return DEFAULT_VOICES;

  try {
    const response = await fetch(`${XAI_BASE}/tts/voices`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) return DEFAULT_VOICES;

    const data = await response.json() as { voices?: XaiVoice[] };
    return data.voices?.length ? data.voices : DEFAULT_VOICES;
  } catch {
    return DEFAULT_VOICES;
  }
}