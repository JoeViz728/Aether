import type { Conversation, ConversationSettings } from '@aether/shared';
import type { ConversationSummary } from './api';

const DEFAULT_CONV_SETTINGS: ConversationSettings = {
  autoModel: true,
  enableWebSearch: true,
  enableXSearch: true,
  enableCodeExecution: true,
  enableMultiAgent: true,
  dictationEnabled: false,
  storyMode: false,
};

export function createDraftConversation(defaultModel: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: '',
    title: 'New chat',
    messages: [],
    branchPoints: [],
    model: defaultModel,
    storyCastPersonaIds: [],
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_CONV_SETTINGS },
  };
}

export function isDraftConversation(
  conversation: Conversation | null,
  conversationId: string | null,
): boolean {
  return Boolean(conversation && !conversationId);
}

export function conversationsWithContent(list: ConversationSummary[]): ConversationSummary[] {
  return list.filter((conversation) => conversation.messageCount > 0);
}