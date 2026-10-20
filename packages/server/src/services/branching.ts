import { v4 as uuid } from 'uuid';
import type { BranchPoint, Conversation, MessageBranch } from '@aether/shared';
import { listBranchVariants } from '@aether/shared';

export const ROOT_PARENT_ID = '__root__';

export function findMessageIndex(conversation: Conversation, messageId: string): number {
  return conversation.messages.findIndex((m) => m.id === messageId);
}

export function resolveParentIndex(conversation: Conversation, parentMessageId: string): number {
  if (parentMessageId === ROOT_PARENT_ID) return -1;
  return findMessageIndex(conversation, parentMessageId);
}

export function getPrefixEnd(parentIdx: number): number {
  return parentIdx + 1;
}

export function ensureBranchPoints(conversation: Conversation): void {
  if (conversation.branchPoints) return;

  conversation.branchPoints = [];
  if (conversation.branches?.length) {
    for (const legacy of conversation.branches) {
      const idx = findMessageIndex(conversation, legacy.forkMessageId);
      const parentMessageId = idx > 0
        ? conversation.messages[idx - 1]?.id ?? ROOT_PARENT_ID
        : ROOT_PARENT_ID;

      const point = getOrCreateBranchPoint(conversation, parentMessageId);
      point.archived.push({
        id: legacy.id,
        label: legacy.label,
        tail: legacy.messages ?? [],
        createdAt: legacy.createdAt,
        source: legacy.source,
      });
    }
    delete conversation.branches;
  }
}

export function getOrCreateBranchPoint(
  conversation: Conversation,
  parentMessageId: string,
): BranchPoint {
  ensureBranchPoints(conversation);
  let point = conversation.branchPoints.find((p) => p.parentMessageId === parentMessageId);
  if (!point) {
    point = {
      parentMessageId,
      archived: [],
      liveTail: null,
      activeSlot: 'live',
    };
    conversation.branchPoints.push(point);
  }
  return point;
}

export function getBranchPoint(
  conversation: Conversation,
  parentMessageId: string,
): BranchPoint | undefined {
  ensureBranchPoints(conversation);
  return conversation.branchPoints.find((p) => p.parentMessageId === parentMessageId);
}

export function archiveCurrentTail(
  conversation: Conversation,
  parentMessageId: string,
  source: MessageBranch['source'],
  label?: string,
): MessageBranch | null {
  ensureBranchPoints(conversation);
  const parentIdx = resolveParentIndex(conversation, parentMessageId);
  const tail = conversation.messages.slice(getPrefixEnd(parentIdx));
  if (tail.length === 0) return null;

  const branch: MessageBranch = {
    id: uuid(),
    label: label ?? `Variant ${getOrCreateBranchPoint(conversation, parentMessageId).archived.length + 1}`,
    tail,
    createdAt: new Date().toISOString(),
    source,
  };

  const point = getOrCreateBranchPoint(conversation, parentMessageId);
  point.archived.push(branch);
  conversation.messages = conversation.messages.slice(0, getPrefixEnd(parentIdx));
  point.activeSlot = 'live';
  point.liveTail = null;

  updateBranchCounts(conversation);
  return branch;
}

export function getParentMessageIdForFork(
  conversation: Conversation,
  messageId: string,
  mode: 'before' | 'from',
): string {
  const index = findMessageIndex(conversation, messageId);
  if (index < 0) throw new Error('Message not found');

  if (mode === 'before') {
    if (index === 0) return ROOT_PARENT_ID;
    return conversation.messages[index - 1].id;
  }

  if (index === 0) return ROOT_PARENT_ID;
  return conversation.messages[index - 1].id;
}

export function truncateFromMessage(
  conversation: Conversation,
  messageId: string,
): number {
  const index = findMessageIndex(conversation, messageId);
  if (index < 0) throw new Error('Message not found');
  conversation.messages = conversation.messages.slice(0, index);
  return index;
}

export function switchBranchVariant(
  conversation: Conversation,
  parentMessageId: string,
  target: 'live' | string,
): boolean {
  ensureBranchPoints(conversation);
  const point = getBranchPoint(conversation, parentMessageId);
  if (!point) return false;

  const parentIdx = resolveParentIndex(conversation, parentMessageId);
  const prefixEnd = getPrefixEnd(parentIdx);
  const currentTail = conversation.messages.slice(prefixEnd);

  if (target === 'live') {
    if (!point.liveTail) return false;
    if (point.activeSlot !== 'live') {
      const active = point.archived.find((b) => b.id === point.activeSlot);
      if (active) active.tail = currentTail;
    }
    conversation.messages = [...conversation.messages.slice(0, prefixEnd), ...point.liveTail];
    point.activeSlot = 'live';
    point.liveTail = null;
    updateBranchCounts(conversation);
    return true;
  }

  const variant = point.archived.find((b) => b.id === target);
  if (!variant) return false;

  if (point.activeSlot === 'live') {
    point.liveTail = currentTail;
  } else {
    const active = point.archived.find((b) => b.id === point.activeSlot);
    if (active) active.tail = currentTail;
  }

  conversation.messages = [...conversation.messages.slice(0, prefixEnd), ...variant.tail];
  point.activeSlot = target;
  updateBranchCounts(conversation);
  return true;
}

export function listVariantsForParent(
  conversation: Conversation,
  parentMessageId: string,
): Array<{ id: 'live' | string; label: string; isActive: boolean }> {
  const variants = listBranchVariants(conversation, parentMessageId);
  if (variants.length > 0) return variants;

  const point = getBranchPoint(conversation, parentMessageId);
  if (!point) return [{ id: 'live', label: 'Current', isActive: true }];
  return [];
}

export function updateBranchCounts(conversation: Conversation): void {
  ensureBranchPoints(conversation);

  for (const msg of conversation.messages) {
    msg.branchCount = 0;
  }

  for (const point of conversation.branchPoints) {
    if (point.archived.length === 0) continue;
    const count = point.archived.length + 1;

    if (point.parentMessageId === ROOT_PARENT_ID) {
      if (conversation.messages[0]) conversation.messages[0].branchCount = count;
      continue;
    }

    const idx = findMessageIndex(conversation, point.parentMessageId);
    if (idx >= 0) conversation.messages[idx].branchCount = count;
  }
}