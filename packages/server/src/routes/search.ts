import type { FastifyInstance } from 'fastify';
import { searchConversations } from '@aether/shared';
import type { DataStore } from '../storage/store.js';

export async function registerSearchRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get<{
    Querystring: { q?: string; limit?: string };
  }>('/api/search/conversations', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (!q) {
      return {
        query: '',
        hits: [],
        scannedConversations: 0,
        truncated: false,
      };
    }
    if (q.length > 200) {
      return reply.status(400).send({ error: 'Query too long (max 200 characters)' });
    }

    const limitRaw = Number(req.query.limit ?? 80);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
      : 80;

    const conversations = await store.listConversations();
    return searchConversations(conversations, q, limit);
  });
}
