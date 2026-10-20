import { v4 as uuid } from 'uuid';
import type { FastifyInstance } from 'fastify';
import {
  isConversationUnread,
  type Conversation,
  type ConversationSettings,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { ChatService } from '../services/chat-service.js';

const DEFAULT_CONV_SETTINGS: ConversationSettings = {
  autoModel: true,
  enableWebSearch: true,
  enableXSearch: true,
  enableCodeExecution: true,
  enableMultiAgent: true,
  dictationEnabled: false,
  storyMode: false,
};

export async function registerConversationRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get('/api/conversations', async () => {
    const conversations = await store.listConversations();
    return conversations
      .filter((conversation) => conversation.messages.length > 0)
      .map(({ messages, ...rest }) => {
        // Legacy chats without lastReadAt are treated as already read at last update.
        const lastReadAt = rest.lastReadAt ?? rest.updatedAt;
        return {
          ...rest,
          lastReadAt,
          messageCount: messages.length,
          preview: messages.find((m) => m.role === 'user')?.content.slice(0, 120) ?? '',
          unread: isConversationUnread({
            messageCount: messages.length,
            updatedAt: rest.updatedAt,
            lastReadAt,
          }),
        };
      });
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    return conversation;
  });

  app.post<{ Body: { title?: string; model?: string; activePersonaId?: string } }>(
    '/api/conversations',
    async (req) => {
      const settings = await store.getSettings();
      const now = new Date().toISOString();
      let title = req.body.title ?? 'New chat';

      if (req.body.activePersonaId) {
        const persona = await store.getPersona(req.body.activePersonaId);
        if (persona) title = persona.name;
      }

      const conversation: Conversation = {
        id: uuid(),
        title,
        messages: [],
        branchPoints: [],
        model: req.body.model ?? settings.defaultModel,
        activePersonaId: req.body.activePersonaId,
        createdAt: now,
        updatedAt: now,
        lastReadAt: now,
        settings: { ...DEFAULT_CONV_SETTINGS },
        storyCastPersonaIds: [],
      };
      await store.saveConversation(conversation);
      return conversation;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<Conversation, 'title' | 'model' | 'settings' | 'activePersonaId' | 'userPersonaId' | 'storyCastPersonaIds'>>;
  }>('/api/conversations/:id', async (req, reply) => {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    if (req.body.title) conversation.title = req.body.title;
    if (req.body.model) conversation.model = req.body.model;
    if (req.body.settings) conversation.settings = { ...conversation.settings, ...req.body.settings };
    if ('activePersonaId' in req.body) conversation.activePersonaId = req.body.activePersonaId;
    if ('userPersonaId' in req.body) conversation.userPersonaId = req.body.userPersonaId;
    if ('storyCastPersonaIds' in req.body) {
      conversation.storyCastPersonaIds = req.body.storyCastPersonaIds ?? [];
    }

    // Metadata edits should not create an unread badge if the chat was already read.
    const wasRead =
      !conversation.lastReadAt ||
      Date.parse(conversation.lastReadAt) >= Date.parse(conversation.updatedAt);
    conversation.updatedAt = new Date().toISOString();
    if (wasRead) {
      conversation.lastReadAt = conversation.updatedAt;
    }

    await store.saveConversation(conversation);
    return conversation;
  });

  /** Mark a conversation as read up through its current updatedAt. */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/read', async (req, reply) => {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    conversation.lastReadAt = conversation.updatedAt;
    await store.saveConversation(conversation);
    return conversation;
  });

  app.post<{
    Params: { id: string };
    Body: { content: string; personaId?: string };
  }>('/api/conversations/:id/seed', async (req, reply) => {
    if (!req.body.content?.trim()) {
      return reply.status(400).send({ error: 'content is required' });
    }

    const chatService = new ChatService(store);
    try {
      const message = await chatService.seedAssistantMessage({
        conversationId: req.params.id,
        content: req.body.content.trim(),
        personaId: req.body.personaId,
      });
      const conversation = await store.getConversation(req.params.id);
      return { message, conversation };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to seed message';
      return reply.status(400).send({ error: msg });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    await store.deleteConversation(req.params.id);
    return { ok: true };
  });
}