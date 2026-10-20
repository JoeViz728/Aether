import type { FastifyInstance } from 'fastify';
import type { ConversationImportCommitRequest } from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { ImportService } from '../services/import-service.js';

const MAX_UPLOAD_BYTES = 120 * 1024 * 1024; // 120 MB

export async function registerImportRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  const importer = new ImportService(store);

  /**
   * Parse an xAI export into a temporary session and return previews.
   * Nothing is written until POST /api/import/conversations/commit.
   */
  app.post('/api/import/conversations/preview', async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.status(400).send({ error: 'Missing file field (multipart name: file)' });
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of file.file) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        return reply.status(413).send({
          error: `File too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`,
        });
      }
      chunks.push(chunk);
    }

    try {
      return await importer.previewFromUpload(
        file.filename || 'upload.bin',
        Buffer.concat(chunks),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  /** Persist selected conversations from a preview session. */
  app.post<{ Body: ConversationImportCommitRequest }>(
    '/api/import/conversations/commit',
    async (req, reply) => {
      const sessionId = req.body?.sessionId;
      const conversationIds = req.body?.conversationIds;
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.status(400).send({ error: 'sessionId required' });
      }
      if (!Array.isArray(conversationIds)) {
        return reply.status(400).send({ error: 'conversationIds array required' });
      }

      try {
        return await importer.commitSession(
          sessionId,
          conversationIds.filter((id): id is string => typeof id === 'string'),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    },
  );

  app.post<{ Body: { sessionId?: string } }>(
    '/api/import/conversations/cancel',
    async (req) => {
      const sessionId = req.body?.sessionId;
      if (!sessionId) return { ok: false };
      return { ok: importer.cancelSession(sessionId) };
    },
  );
}
