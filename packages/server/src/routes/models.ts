import type { FastifyInstance } from 'fastify';
import { isApiKeyConfigured } from '../env.js';
import { listAvailableModels } from '../services/xai-client.js';

export async function registerModelsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models', async () => {
    if (!isApiKeyConfigured()) {
      return { models: [] };
    }
    const ids = await listAvailableModels();
    return { models: ids };
  });
}
