import type { AppSettings, ApprovalRequest, Conversation } from '@aether/shared';
import type { ConversationSummary } from './api';

const KEYS = {
  settings: 'aether:cache:settings',
  conversations: 'aether:cache:conversations',
  health: 'aether:cache:health',
  activeConversationId: 'aether:cache:active-conversation-id',
  conversation: (id: string) => `aether:cache:conversation:${id}`,
  approvals: 'aether:cache:approvals',
} as const;

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function saveBootstrap(data: {
  settings: AppSettings;
  conversations: ConversationSummary[];
  apiKeyConfigured: boolean;
  approvals?: ApprovalRequest[];
}): void {
  writeJson(KEYS.settings, data.settings);
  writeJson(KEYS.conversations, data.conversations);
  writeJson(KEYS.health, { apiKeyConfigured: data.apiKeyConfigured });
  if (data.approvals) writeJson(KEYS.approvals, data.approvals);
}

export function saveConversation(conversation: Conversation): void {
  writeJson(KEYS.conversation(conversation.id), conversation);
  writeJson(KEYS.activeConversationId, conversation.id);
}

export function saveConversations(conversations: ConversationSummary[]): void {
  writeJson(KEYS.conversations, conversations);
}

export function saveSettings(settings: AppSettings): void {
  writeJson(KEYS.settings, settings);
}

export function loadBootstrap(): {
  settings: AppSettings;
  conversations: ConversationSummary[];
  apiKeyConfigured: boolean;
  approvals: ApprovalRequest[];
  activeConversationId: string | null;
} | null {
  const settings = readJson<AppSettings>(KEYS.settings);
  const conversations = readJson<ConversationSummary[]>(KEYS.conversations);
  if (!settings || !conversations) return null;

  const health = readJson<{ apiKeyConfigured: boolean }>(KEYS.health);
  const approvals = readJson<ApprovalRequest[]>(KEYS.approvals) ?? [];
  const activeConversationId = readJson<string>(KEYS.activeConversationId);

  return {
    settings,
    conversations,
    apiKeyConfigured: health?.apiKeyConfigured ?? false,
    approvals,
    activeConversationId: typeof activeConversationId === 'string' ? activeConversationId : null,
  };
}

export function loadConversation(id: string): Conversation | null {
  return readJson<Conversation>(KEYS.conversation(id));
}