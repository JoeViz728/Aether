import type { Conversation } from '@aether/shared';
import { listBranchVariants as listBranchVariantsShared } from '@aether/shared';

export const ROOT_PARENT_ID = '__root__';

export function getParentMessageId(
  conversation: Conversation,
  messageIndex: number,
): string {
  if (messageIndex <= 0) return ROOT_PARENT_ID;
  return conversation.messages[messageIndex - 1].id;
}

export function getBranchPoint(
  conversation: Conversation | null,
  parentMessageId: string,
) {
  return conversation?.branchPoints?.find((p) => p.parentMessageId === parentMessageId);
}

export function isFirstMessageAfterParent(
  conversation: Conversation,
  messageIndex: number,
): boolean {
  const parentId = getParentMessageId(conversation, messageIndex);
  if (parentId === ROOT_PARENT_ID) return messageIndex === 0;
  const parentIdx = conversation.messages.findIndex((m) => m.id === parentId);
  return parentIdx >= 0 && messageIndex === parentIdx + 1;
}

export function listBranchVariants(
  conversation: Conversation,
  parentMessageId: string,
) {
  return listBranchVariantsShared(conversation, parentMessageId);
}

export function hasBranchVariants(
  conversation: Conversation | null,
  parentMessageId: string,
): boolean {
  const point = getBranchPoint(conversation, parentMessageId);
  return Boolean(point && point.archived.length > 0);
}