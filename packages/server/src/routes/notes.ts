import type { FastifyInstance } from 'fastify';
import type { NotesOp, NotesScopeRef, ToolScopeConfig } from '@aether/shared';
import { NOTES_TOOL_ID, normalizeToolScopeConfig } from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { NotesService } from '../services/notes-service.js';

export async function registerNotesRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  const notes = new NotesService(store);

  /**
   * User UI always reads vaults freely. `effective` describes model policy for the chat.
   */
  app.get<{
    Querystring: {
      scope?: string;
      conversationId?: string;
      personaId?: string;
    };
  }>('/api/notes', async (req, reply) => {
    const scopeKind = req.query.scope === 'conversation' ? 'conversation' : 'root';
    const scope: NotesScopeRef =
      scopeKind === 'root'
        ? { kind: 'root' }
        : { kind: 'conversation', conversationId: req.query.conversationId };

    if (scope.kind === 'conversation' && !scope.conversationId) {
      return reply.status(400).send({ error: 'conversationId required for conversation scope' });
    }

    const resolved = await notes.resolveEffectiveScope({
      conversationId: req.query.conversationId,
      personaId: req.query.personaId,
    });

    const vault = await notes.getVault(scope);
    return {
      vault,
      effective: resolved.config,
      source: resolved.source,
      conversationOverride: resolved.conversationOverride,
      toolId: NOTES_TOOL_ID,
    };
  });

  app.get<{
    Querystring: { conversationId?: string; personaId?: string };
  }>('/api/notes/scope', async (req) => {
    const resolved = await notes.resolveEffectiveScope({
      conversationId: req.query.conversationId,
      personaId: req.query.personaId,
    });
    const settings = await store.getSettings();
    return {
      effective: resolved.config,
      source: resolved.source,
      conversationOverride: resolved.conversationOverride,
      defaults: settings.notesScopeDefaults,
      toolId: NOTES_TOOL_ID,
    };
  });

  app.post<{
    Body: {
      op: NotesOp;
      conversationId?: string;
      personaId?: string;
      /** Default user for REST UI */
      actor?: 'user' | 'model';
    };
  }>('/api/notes/ops', async (req, reply) => {
    if (!req.body?.op) {
      return reply.status(400).send({ error: 'op required' });
    }
    const result = await notes.applyOp(req.body.op, {
      conversationId: req.body.conversationId,
      personaId: req.body.personaId,
      actor: req.body.actor ?? 'user',
    });
    if (!result.ok) {
      return reply.status(400).send(result);
    }
    return result;
  });

  app.get('/api/notes/trash', async () => {
    const items = await notes.listTrash();
    return { items };
  });

  app.post<{ Body: { trashId: string } }>('/api/notes/trash/restore', async (req, reply) => {
    if (!req.body?.trashId) {
      return reply.status(400).send({ error: 'trashId required' });
    }
    const result = await notes.restoreTrashItem(req.body.trashId);
    if (!result.ok) {
      return reply.status(400).send(result);
    }
    return result;
  });

  app.post('/api/notes/trash/empty', async () => {
    return notes.emptyTrash();
  });

  /**
   * Set or clear conversation-level notes scope override.
   * Body: ToolScopeConfig | { clear: true }
   */
  app.put<{
    Params: { conversationId: string };
    Body: (ToolScopeConfig & { clear?: never }) | { clear: true };
  }>('/api/notes/scope/conversation/:conversationId', async (req, reply) => {
    const convo = await store.getConversation(req.params.conversationId);
    if (!convo) return reply.status(404).send({ error: 'Conversation not found' });

    if (req.body && 'clear' in req.body && req.body.clear) {
      if (convo.settings.toolScopes) {
        const next = { ...convo.settings.toolScopes };
        delete next[NOTES_TOOL_ID];
        convo.settings = {
          ...convo.settings,
          toolScopes: Object.keys(next).length ? next : undefined,
        };
      }
    } else {
      const normalized = normalizeToolScopeConfig(req.body as ToolScopeConfig);
      if (!normalized) {
        return reply.status(400).send({ error: 'access must be all | conversation | none' });
      }
      convo.settings = {
        ...convo.settings,
        toolScopes: {
          ...convo.settings.toolScopes,
          [NOTES_TOOL_ID]: normalized,
        },
      };
    }

    convo.updatedAt = new Date().toISOString();
    await store.saveConversation(convo);

    const resolved = await notes.resolveEffectiveScope({
      conversationId: convo.id,
      personaId: convo.activePersonaId,
    });
    return {
      config: convo.settings.toolScopes?.[NOTES_TOOL_ID] ?? null,
      effective: resolved.config,
      source: resolved.source,
      conversationOverride: resolved.conversationOverride,
      conversationId: convo.id,
    };
  });
}
