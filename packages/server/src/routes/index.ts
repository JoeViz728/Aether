import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { DataStore } from '../storage/store.js';
import { registerChatRoutes } from './chat.js';
import { registerConversationRoutes } from './conversations.js';
import { registerSettingsRoutes } from './settings.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerVoiceRoutes } from './voice.js';
import { registerExtensionRoutes } from './extensions.js';
import { registerToolsRoutes } from './tools.js';
import { registerNotesRoutes } from './notes.js';
import { registerPersonaRoutes } from './personas.js';
import { registerHealthRoutes } from './health.js';
import { registerTaskRoutes } from './tasks.js';
import { registerModelsRoutes } from './models.js';
import { registerImportRoutes } from './import.js';
import { registerSearchRoutes } from './search.js';

export interface ServerContext {
  dataDir: string;
}

export async function registerRoutes(
  app: FastifyInstance,
  ctx: ServerContext,
): Promise<void> {
  const store = new DataStore(ctx.dataDir);

  await app.register(multipart, { limits: { fileSize: 120 * 1024 * 1024 } });

  await registerHealthRoutes(app);
  await registerTaskRoutes(app);
  await registerModelsRoutes(app);
  await registerSettingsRoutes(app, store);
  await registerConversationRoutes(app, store);
  await registerChatRoutes(app, store);
  await registerApprovalRoutes(app, store);
  await registerVoiceRoutes(app);
  await registerExtensionRoutes(app, store);
  await registerToolsRoutes(app, store);
  await registerNotesRoutes(app, store);
  await registerImportRoutes(app, store);
  await registerSearchRoutes(app, store);
  await registerPersonaRoutes(app, store);
}