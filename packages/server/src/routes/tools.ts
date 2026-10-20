import { v4 as uuid } from 'uuid';
import type { FastifyInstance } from 'fastify';
import type { Tool } from '@aether/shared';
import { NOTES_TOOL_ID, NOTES_TOOL_KIND } from '@aether/shared';
import type { DataStore } from '../storage/store.js';

export async function registerToolsRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get('/api/tools', async () => {
    const tools = await store.listTools();
    // Always surface known builtins for visibility even if not persisted
    const builtins = getBuiltinTools();
    const merged = mergeBuiltinTools(builtins, tools);
    return merged;
  });

  app.post<{ Body: Omit<Tool, 'id' | 'createdAt' | 'updatedAt' | 'enabled'> & Partial<Pick<Tool, 'enabled'>> }>(
    '/api/tools',
    async (req) => {
      const now = new Date().toISOString();
      const tool: Tool = {
        id: uuid(),
        name: req.body.name,
        description: req.body.description,
        kind: req.body.kind,
        owner: req.body.owner ?? 'user',
        config: req.body.config,
        state: req.body.state,
        enabled: req.body.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      await store.saveTool(tool);
      return tool;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<Tool, 'name' | 'description' | 'config' | 'state' | 'enabled' | 'kind'>>;
  }>('/api/tools/:id', async (req, reply) => {
    const tools = await store.listTools();
    const tool = tools.find((t) => t.id === req.params.id);
    if (!tool) return reply.status(404).send({ error: 'Tool not found' });

    const now = new Date().toISOString();
    if (req.body.name !== undefined) tool.name = req.body.name;
    if (req.body.description !== undefined) tool.description = req.body.description;
    if (req.body.kind !== undefined) tool.kind = req.body.kind;
    if (req.body.config !== undefined) tool.config = req.body.config;
    if (req.body.state !== undefined) tool.state = req.body.state;
    if (req.body.enabled !== undefined) tool.enabled = req.body.enabled;
    tool.updatedAt = now;

    await store.saveTool(tool);
    return tool;
  });
}

/** Static list of well-known builtin tools for the Tools & Automation UI. */
function getBuiltinTools(): Tool[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'builtin:web_search',
      name: 'Web Search',
      description: 'Search the web for current information and cite sources.',
      kind: 'search',
      owner: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'builtin:x_search',
      name: 'X Search',
      description: 'Search X (Twitter) for posts and discussions.',
      kind: 'search',
      owner: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'builtin:code_execution',
      name: 'Code Execution',
      description: 'Run code (Python) for calculations, data processing, and visualization.',
      kind: 'code',
      owner: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: NOTES_TOOL_ID,
      name: 'Linked Notes',
      description:
        'Obsidian-style linked notes with deliberate edges. Root library plus per-conversation case files; promote case notes upward. Full graph UI and model ops.',
      kind: NOTES_TOOL_KIND,
      owner: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function mergeBuiltinTools(builtins: Tool[], persisted: Tool[]): Tool[] {
  const persistedById = new Map(persisted.map((t) => [t.id, t]));
  const result: Tool[] = [];

  for (const b of builtins) {
    const p = persistedById.get(b.id);
    result.push(p ?? b);
    if (p) persistedById.delete(b.id);
  }

  // Add any user/model-created tools
  for (const remaining of persistedById.values()) {
    result.push(remaining);
  }

  return result;
}
