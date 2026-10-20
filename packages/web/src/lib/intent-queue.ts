import type {
  ChatMessage,
  Conversation,
  ConversationSettings,
  ResponderType,
} from '@aether/shared';
import { DRAFT_CONVERSATION_REF } from './client-offline';

export { DRAFT_CONVERSATION_REF };

export interface PendingChatSummary {
  localConversationRef: string;
  title: string;
  preview: string;
  updatedAt: string;
  intentIds: string[];
  isDraft: boolean;
}

const SNAPSHOTS_KEY = 'aether:pending-chat-snapshots';

export type QueuedIntentType = 'send' | 'initiate' | 'insert' | 'regenerate' | 'edit';

export type QueuedIntentStatus = 'pending' | 'submitting';

export interface DraftMaterializeOpts {
  model?: string;
  activePersonaId?: string | null;
  settings?: Partial<ConversationSettings>;
}

interface QueuedIntentBase {
  id: string;
  type: QueuedIntentType;
  localConversationRef: string;
  conversationTitle?: string;
  createdAt: string;
  status: QueuedIntentStatus;
}

export interface QueuedSendIntent extends QueuedIntentBase {
  type: 'send';
  message: string;
  userMessage: ChatMessage;
  model?: string;
  personaId?: string;
  settings?: Partial<ConversationSettings>;
  draftMaterialize?: DraftMaterializeOpts;
}

export interface QueuedInitiateIntent extends QueuedIntentBase {
  type: 'initiate';
  influencePrompt?: string;
  personaId?: string;
  model?: string;
  settings?: Partial<ConversationSettings>;
  draftMaterialize: DraftMaterializeOpts;
}

export interface QueuedInsertIntent extends QueuedIntentBase {
  type: 'insert';
  influencePrompt?: string;
  respondAs?: { type: ResponderType; id: string };
}

export interface QueuedRegenerateIntent extends QueuedIntentBase {
  type: 'regenerate';
  messageId: string;
  influencePrompt?: string;
  respondAs?: { type: ResponderType; id: string };
}

export interface QueuedEditIntent extends QueuedIntentBase {
  type: 'edit';
  messageId: string;
  content: string;
}

export type QueuedIntent =
  | QueuedSendIntent
  | QueuedInitiateIntent
  | QueuedInsertIntent
  | QueuedRegenerateIntent
  | QueuedEditIntent;

const STORAGE_KEY = 'aether:intent-queue';

export function intentTaskTitle(intent: QueuedIntent): string {
  switch (intent.type) {
    case 'send':
      return 'Generating response';
    case 'initiate':
      return 'Initiating chat';
    case 'insert':
      return 'Generating response';
    case 'regenerate':
      return 'Regenerating response';
    case 'edit':
      return 'Editing message';
  }
}

export function queuedIntentDescription(intent: QueuedIntent): string {
  switch (intent.type) {
    case 'initiate':
      return 'The selected model or persona will open this conversation when you reconnect.';
    case 'regenerate':
      return 'This response will be regenerated when you reconnect, creating an alternate branch.';
    case 'edit':
      return 'This message will be edited when you reconnect, creating an alternate branch.';
    case 'insert':
      return 'A new response will be inserted at the end when you reconnect.';
    case 'send':
      return 'Your message and the reply will be sent when you reconnect.';
  }
}

export function listPendingIntentsForRef(
  intents: QueuedIntent[],
  localConversationRef: string,
): QueuedIntent[] {
  return intents.filter(
    (intent) =>
      intent.localConversationRef === localConversationRef && intent.status === 'pending',
  );
}

export function loadQueuedIntents(): QueuedIntent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedIntent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueuedIntents(intents: QueuedIntent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(intents));
  } catch {
    /* quota */
  }
}

export function createPendingChatRef(): string {
  return `pending:${crypto.randomUUID()}`;
}

export function isPendingChatRef(ref: string): boolean {
  return ref === DRAFT_CONVERSATION_REF || ref.startsWith('pending:');
}

export function resolveLocalConversationRef(
  activeConversationId: string | null,
  isDraft: boolean,
  activePendingChatRef?: string | null,
): string {
  if (isDraft) return activePendingChatRef ?? DRAFT_CONVERSATION_REF;
  return activeConversationId ?? DRAFT_CONVERSATION_REF;
}

export function getActiveLocalConversationRef(
  activeConversationId: string | null,
  activeConversation: Conversation | null,
  activePendingChatRef: string | null,
  isDraft: boolean,
): string | null {
  if (!activeConversation) return null;
  if (isDraft) return activePendingChatRef ?? DRAFT_CONVERSATION_REF;
  return activeConversationId;
}

export function needsServerMaterialize(ref: string): boolean {
  return isPendingChatRef(ref);
}

export function listPendingChatSummaries(
  intents: QueuedIntent[],
  existingConversationIds: Set<string>,
): PendingChatSummary[] {
  const byRef = new Map<string, QueuedIntent[]>();

  for (const intent of intents) {
    if (intent.status !== 'pending') continue;
    const list = byRef.get(intent.localConversationRef) ?? [];
    list.push(intent);
    byRef.set(intent.localConversationRef, list);
  }

  const summaries: PendingChatSummary[] = [];

  for (const [ref, refIntents] of byRef) {
    if (!ref) continue;
    const isDraft = isPendingChatRef(ref);
    if (!isDraft && existingConversationIds.has(ref)) continue;

    const sendIntent = refIntents.find((intent): intent is QueuedSendIntent => intent.type === 'send');
    const title = sendIntent
      ? sendIntent.message.slice(0, 60) + (sendIntent.message.length > 60 ? '…' : '')
      : refIntents[0].conversationTitle ?? 'New chat';
    const preview = sendIntent
      ? sendIntent.message.slice(0, 120)
      : refIntents.some((intent) => intent.type === 'initiate')
        ? 'Waiting to initiate…'
        : 'Waiting to connect…';

    summaries.push({
      localConversationRef: ref,
      title,
      preview,
      updatedAt: refIntents[refIntents.length - 1]?.createdAt ?? new Date().toISOString(),
      intentIds: refIntents.map((intent) => intent.id),
      isDraft,
    });
  }

  return summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function loadPendingChatSnapshots(): Record<string, Conversation> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Conversation>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePendingChatSnapshots(snapshots: Record<string, Conversation>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch {
    /* quota */
  }
}