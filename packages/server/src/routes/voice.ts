import type { FastifyInstance } from 'fastify';
import { isApiKeyConfigured } from '../env.js';
import { listVoices, synthesizeSpeech, transcribeAudio } from '../services/xai-voice.js';

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/voice/voices', async (_req, reply) => {
    if (!isApiKeyConfigured()) {
      return reply.status(503).send({ error: 'API key not configured', voices: [] });
    }

    const voices = await listVoices();
    return { voices };
  });

  app.post<{ Body: { text: string; voice?: string; language?: string } }>(
    '/api/voice/tts',
    async (req, reply) => {
      const { text, voice, language } = req.body;
      if (!text?.trim()) return reply.status(400).send({ error: 'text is required' });

      if (!isApiKeyConfigured()) {
        return reply.status(503).send({ error: 'API key not configured', fallback: true });
      }

      try {
        const { buffer, contentType } = await synthesizeSpeech({
          text: text.trim(),
          voiceId: voice,
          language,
        });

        reply.header('Content-Type', contentType);
        return reply.send(buffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'TTS failed';
        return reply.status(500).send({ error: message, fallback: true });
      }
    },
  );

  app.post('/api/voice/stt', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'Audio file required' });

    if (!isApiKeyConfigured()) {
      return reply.status(503).send({ error: 'API key not configured', fallback: true });
    }

    try {
      const buffer = await data.toBuffer();
      const text = await transcribeAudio({
        buffer,
        filename: data.filename ?? 'recording.webm',
        mimeType: data.mimetype,
      });

      return { text };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'STT failed';
      return reply.status(500).send({ error: message, fallback: true });
    }
  });
}