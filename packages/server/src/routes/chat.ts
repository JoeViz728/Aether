import type { FastifyInstance } from 'fastify';
import type {
  ChatCompletionRequest,
  EditMessageRequest,
  InitiateChatRequest,
  InsertResponseRequest,
  RegenerateRequest,
  StreamEvent,
} from '@aether/shared';
import { bumpConversationActivity } from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { ChatService } from '../services/chat-service.js';
import { switchBranchVariant } from '../services/branching.js';
import { taskManager } from '../services/task-manager.js';

function streamReply(
  reply: { raw: { writeHead: Function; write: Function; end: Function; on: Function } },
  handler: (send: (event: StreamEvent) => void, abortSignal: AbortSignal) => Promise<void>,
  taskMeta?: { id?: string; title: string; conversationId?: string },
): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let clientConnected = true;
  const abortController = new AbortController();

  reply.raw.on('close', () => {
    clientConnected = false;
  });

  if (taskMeta) {
    taskManager.create(
      {
        id: taskMeta.id,
        category: 'chat',
        title: taskMeta.title,
        conversationId: taskMeta.conversationId,
        cancellable: true,
      },
      () => abortController.abort(),
    );
    if (taskMeta.id) {
      taskManager.update(taskMeta.id, { logLine: 'Stream started' });
    }
  }

  const send = (event: StreamEvent) => {
    if (!clientConnected || abortController.signal.aborted) return;
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      clientConnected = false;
    }
  };

  handler(send, abortController.signal)
    .then(() => {
      if (taskMeta?.id && !abortController.signal.aborted) {
        taskManager.complete(taskMeta.id, 'Stream finished');
      }
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'Request failed';
      if (abortController.signal.aborted) {
        const existing = taskMeta?.id ? taskManager.get(taskMeta.id) : undefined;
        if (taskMeta?.id && existing?.status === 'running') {
          taskManager.cancel(taskMeta.id);
        }
      } else {
        if (taskMeta?.id) taskManager.fail(taskMeta.id, msg);
        send({ type: 'error', data: { message: msg } });
      }
    })
    .finally(() => {
      if (clientConnected) {
        try {
          reply.raw.end();
        } catch {
          /* socket already closed */
        }
      }
    });
}

export async function registerChatRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  const chatService = new ChatService(store);

  app.post<{ Body: ChatCompletionRequest }>('/api/chat', async (req, reply) => {
    const { conversationId, message, model, personaId, settings, taskId } = req.body;
    if (!conversationId || !message?.trim()) {
      return reply.status(400).send({ error: 'conversationId and message are required' });
    }

    streamReply(
      reply,
      async (send, abortSignal) => {
        await chatService.streamChat({
          conversationId,
          message: message.trim(),
          model,
          personaId,
          settings,
          onEvent: send,
          abortSignal,
        });
      },
      { id: taskId, title: 'Generating response', conversationId },
    );
  });

  app.post<{ Body: InitiateChatRequest }>('/api/chat/initiate', async (req, reply) => {
    const { conversationId, personaId, model, influencePrompt, taskId } = req.body;
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId is required' });
    }

    streamReply(
      reply,
      async (send, abortSignal) => {
        await chatService.initiateChat({
          conversationId,
          personaId,
          model,
          influencePrompt,
          onEvent: send,
          abortSignal,
        });
      },
      { id: taskId, title: 'Initiating chat', conversationId },
    );
  });

  app.post<{ Body: InsertResponseRequest }>('/api/chat/insert', async (req, reply) => {
    const { conversationId, influencePrompt, respondAs, taskId } = req.body;
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId is required' });
    }

    streamReply(
      reply,
      async (send, abortSignal) => {
        await chatService.insertResponse({
          conversationId,
          influencePrompt,
          respondAs,
          onEvent: send,
          abortSignal,
        });
      },
      { id: taskId, title: 'Generating response', conversationId },
    );
  });

  app.post<{ Body: RegenerateRequest }>('/api/chat/regenerate', async (req, reply) => {
    const { conversationId, messageId, influencePrompt, respondAs, taskId } = req.body;
    if (!conversationId || !messageId) {
      return reply.status(400).send({ error: 'conversationId and messageId are required' });
    }

    streamReply(
      reply,
      async (send, abortSignal) => {
        await chatService.regenerate({
          conversationId,
          messageId,
          influencePrompt,
          respondAs,
          onEvent: send,
          abortSignal,
        });
      },
      { id: taskId, title: 'Regenerating response', conversationId },
    );
  });

  app.post<{ Body: EditMessageRequest }>('/api/chat/edit', async (req, reply) => {
    const { conversationId, messageId, content, taskId } = req.body;
    if (!conversationId || !messageId || !content?.trim()) {
      return reply.status(400).send({ error: 'conversationId, messageId, and content are required' });
    }

    streamReply(
      reply,
      async (send, abortSignal) => {
        await chatService.editMessage({
          conversationId,
          messageId,
          content: content.trim(),
          onEvent: send,
          abortSignal,
        });
      },
      { id: taskId, title: 'Editing message', conversationId },
    );
  });

  app.post<{
    Body: { conversationId: string; parentMessageId: string; target: 'live' | string };
  }>('/api/chat/switch-branch', async (req, reply) => {
    const { conversationId, parentMessageId, target } = req.body;
    const conversation = await store.getConversation(conversationId);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const ok = switchBranchVariant(conversation, parentMessageId, target);
    if (!ok) return reply.status(400).send({ error: 'Branch variant not found' });

    bumpConversationActivity(conversation);
    await store.saveConversation(conversation);
    return conversation;
  });
}