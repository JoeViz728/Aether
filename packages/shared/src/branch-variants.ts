import type { BranchPoint, ChatMessage, Conversation } from './types.js';
import { getMessageSortTime } from './message-time.js';

export const ROOT_PARENT_ID = '__root__';

export interface BranchVariantOption {
  id: 'live' | string;
  label: string;
  isActive: boolean;
}

function prefixEndIndex(conversation: Conversation, parentMessageId: string): number {
  if (parentMessageId === ROOT_PARENT_ID) return 0;
  const idx = conversation.messages.findIndex((m) => m.id === parentMessageId);
  return idx < 0 ? 0 : idx + 1;
}

function variantHeadMessage(
  conversation: Conversation,
  point: BranchPoint,
  variantId: 'live' | string,
): ChatMessage | undefined {
  const prefixEnd = prefixEndIndex(conversation, point.parentMessageId);

  if (variantId === 'live') {
    return point.activeSlot === 'live'
      ? conversation.messages[prefixEnd]
      : point.liveTail?.[0];
  }

  return point.archived.find((b) => b.id === variantId)?.tail[0];
}

function variantSortTime(
  conversation: Conversation,
  point: BranchPoint,
  variantId: 'live' | string,
): number {
  const head = variantHeadMessage(conversation, point, variantId);
  if (head) return getMessageSortTime(head);

  if (variantId !== 'live') {
    const branch = point.archived.find((b) => b.id === variantId);
    if (branch?.createdAt) {
      const parsed = Date.parse(branch.createdAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }

  return 0;
}

export function listBranchVariants(
  conversation: Conversation,
  parentMessageId: string,
): BranchVariantOption[] {
  const point = conversation.branchPoints?.find((p) => p.parentMessageId === parentMessageId);
  if (!point || point.archived.length === 0) return [];

  const variants: BranchVariantOption[] = [
    ...point.archived.map((b) => ({
      id: b.id as 'live' | string,
      label: b.label,
      isActive: point.activeSlot === b.id,
    })),
    {
      id: 'live',
      label: point.liveTail ? 'Latest' : 'Current',
      isActive: point.activeSlot === 'live',
    },
  ];

  return variants.sort((a, b) => {
    const delta = variantSortTime(conversation, point, a.id) - variantSortTime(conversation, point, b.id);
    return delta !== 0 ? delta : String(a.id).localeCompare(String(b.id));
  });
}