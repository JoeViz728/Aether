import type { ChatMessage, Conversation } from './types.js';

export function getMessageSortTime(message: ChatMessage | undefined): number {
  if (!message?.createdAt) return 0;
  const parsed = Date.parse(message.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ensureConversationTimestamps(conversation: Conversation): boolean {
  let changed = false;
  const seen = new Set<string>();
  const base = Date.parse(conversation.createdAt) || Date.now();
  let offset = 0;

  const assign = (msg: ChatMessage) => {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
    if (!msg.createdAt || Number.isNaN(Date.parse(msg.createdAt))) {
      msg.createdAt = new Date(base + offset).toISOString();
      changed = true;
    }
    offset += 1000;
  };

  for (const msg of conversation.messages) assign(msg);
  for (const point of conversation.branchPoints ?? []) {
    for (const branch of point.archived) {
      for (const msg of branch.tail) assign(msg);
    }
    for (const msg of point.liveTail ?? []) assign(msg);
  }

  return changed;
}