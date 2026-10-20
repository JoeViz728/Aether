import type { FastifyInstance } from 'fastify';
import type { AppSettings } from '@aether/shared';
import type { DataStore } from '../storage/store.js';

export async function registerSettingsRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get('/api/settings', async () => store.getSettings());

  app.patch<{ Body: Partial<AppSettings> }>('/api/settings', async (req) => {
    return store.updateSettings(req.body);
  });
}