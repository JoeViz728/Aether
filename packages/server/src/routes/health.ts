import type { FastifyInstance } from 'fastify';
import { isApiKeyConfigured } from '../env.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    status: 'ok',
    name: 'aether',
    version: '0.1.0',
    apiKeyConfigured: isApiKeyConfigured(),
  }));

  app.get('/api/ping', async () => ({
    pong: true,
    at: new Date().toISOString(),
  }));
}