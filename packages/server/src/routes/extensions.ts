import { v4 as uuid } from 'uuid';
import type { FastifyInstance } from 'fastify';
import type { ExtensionManifest } from '@aether/shared';
import type { DataStore } from '../storage/store.js';

export async function registerExtensionRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get('/api/extensions', async () => store.listExtensions());

  app.post<{ Body: Omit<ExtensionManifest, 'id' | 'installedAt'> }>(
    '/api/extensions',
    async (req) => {
      const ext: ExtensionManifest = {
        ...req.body,
        id: uuid(),
        installedAt: new Date().toISOString(),
      };
      await store.saveExtension(ext);
      return ext;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<ExtensionManifest, 'enabled' | 'tools'>>;
  }>('/api/extensions/:id', async (req, reply) => {
    const extensions = await store.listExtensions();
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return reply.status(404).send({ error: 'Extension not found' });

    if (req.body.enabled !== undefined) ext.enabled = req.body.enabled;
    if (req.body.tools) ext.tools = req.body.tools;

    await store.saveExtension(ext);
    return ext;
  });

  app.get('/api/extensions/registry', async () => ({
    description: 'Aether extension registry — tools built by Grok Build can be registered here',
    schema: {
      manifest: {
        name: 'string',
        version: 'string',
        description: 'string',
        tools: [{
          name: 'string',
          description: 'string',
          parameters: 'JSON Schema object',
          handler: "'server' | 'client'",
        }],
      },
    },
    endpoints: {
      register: 'POST /api/extensions',
      list: 'GET /api/extensions',
      requestBuild: 'POST /api/approvals (type: build)',
    },
  }));
}