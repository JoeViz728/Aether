/** True when the conversation has content the user has not opened since it last changed. */
export function isConversationUnread(input: {
  messageCount?: number;
  messagesLength?: number;
  updatedAt: string;
  lastReadAt?: string | null;
}): boolean {
  const messageCount = input.messageCount ?? input.messagesLength ?? 0;
  if (messageCount <= 0) return false;

  // Missing lastReadAt = legacy / not yet tracked → treat as read until next content update.
  if (!input.lastReadAt) return false;

  const updated = Date.parse(input.updatedAt);
  const read = Date.parse(input.lastReadAt);
  if (Number.isNaN(updated) || Number.isNaN(read)) return false;
  return updated > read;
}

/**
 * Bump updatedAt for new content. Seeds lastReadAt first when missing so the bump
 * correctly marks the conversation unread instead of treating it as still-read.
 */
export function bumpConversationActivity(conversation: {
  updatedAt: string;
  lastReadAt?: string;
}): void {
  if (!conversation.lastReadAt) {
    conversation.lastReadAt = conversation.updatedAt;
  }
  conversation.updatedAt = new Date().toISOString();
}
