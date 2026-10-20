import { create } from 'zustand';
import type { ChatMessage, Conversation } from '@aether/shared';
import {
  intentTaskTitle,
  listPendingChatSummaries,
  listPendingIntentsForRef,
  loadPendingChatSnapshots,
  loadQueuedIntents,
  savePendingChatSnapshots,
  saveQueuedIntents,
  type PendingChatSummary,
  type QueuedIntent,
} from '../lib/intent-queue';
import { useTaskStore } from './task-store';

interface IntentQueueStore {
  intents: QueuedIntent[];
  snapshots: Record<string, Conversation>;
  enqueue: (intent: QueuedIntent, options?: { conversationSnapshot?: Conversation }) => void;
  remove: (id: string) => void;
  cancelPendingChat: (localConversationRef: string) => void;
  hasIntent: (id: string) => boolean;
  hasPending: () => boolean;
  hasPendingForRef: (localConversationRef: string) => boolean;
  getPending: () => QueuedIntent[];
  getPendingSidebarChats: (existingConversationIds: string[]) => PendingChatSummary[];
  getConversationSnapshot: (localConversationRef: string) => Conversation | undefined;
  markSubmitting: (id: string) => void;
  markPending: (id: string) => void;
  remapConversationRef: (fromRef: string, toRef: string) => void;
  getQueuedUserMessages: (localConversationRef: string) => ChatMessage[];
  getPendingIntentsForRef: (localConversationRef: string) => QueuedIntent[];
  hydrateTaskLog: () => void;
}

function persistSnapshots(snapshots: Record<string, Conversation>): void {
  savePendingChatSnapshots(snapshots);
}

export const useIntentQueueStore = create<IntentQueueStore>((set, get) => ({
  intents: loadQueuedIntents(),
  snapshots: loadPendingChatSnapshots(),

  enqueue: (intent, options) => {
    const intents = [...get().intents, intent];
    saveQueuedIntents(intents);

    const snapshots = { ...get().snapshots };
    if (options?.conversationSnapshot) {
      snapshots[intent.localConversationRef] = options.conversationSnapshot;
      persistSnapshots(snapshots);
    }

    set({ intents, snapshots });

    useTaskStore.getState().registerTask({
      id: intent.id,
      category: 'chat',
      title: intentTaskTitle(intent),
      detail: 'Waiting to connect',
      status: 'pending',
      conversationId: intent.localConversationRef,
      conversationTitle: intent.conversationTitle,
      cancellable: true,
      onAbort: () => get().remove(intent.id),
    });
  },

  remove: (id) => {
    const intent = get().intents.find((entry) => entry.id === id);
    const intents = get().intents.filter((entry) => entry.id !== id);
    saveQueuedIntents(intents);

    const snapshots = { ...get().snapshots };
    if (
      intent &&
      !intents.some((entry) => entry.localConversationRef === intent.localConversationRef)
    ) {
      delete snapshots[intent.localConversationRef];
      persistSnapshots(snapshots);
    }

    set({ intents, snapshots });
  },

  cancelPendingChat: (localConversationRef) => {
    const intentIds = get()
      .intents
      .filter((intent) => intent.localConversationRef === localConversationRef)
      .map((intent) => intent.id);

    for (const id of intentIds) {
      useTaskStore.getState().markCancelled(id, 'Removed from queue');
      get().remove(id);
    }
  },

  hasIntent: (id) => get().intents.some((intent) => intent.id === id),

  hasPending: () => get().intents.some((intent) => intent.status === 'pending'),

  hasPendingForRef: (localConversationRef) =>
    get().intents.some(
      (intent) =>
        intent.localConversationRef === localConversationRef && intent.status === 'pending',
    ),

  getPending: () => get().intents.filter((intent) => intent.status === 'pending'),

  getPendingSidebarChats: (existingConversationIds) =>
    listPendingChatSummaries(get().intents, new Set(existingConversationIds)),

  getConversationSnapshot: (localConversationRef) => get().snapshots[localConversationRef],

  markSubmitting: (id) => {
    const intents = get().intents.map((intent) =>
      intent.id === id ? { ...intent, status: 'submitting' as const } : intent,
    );
    saveQueuedIntents(intents);
    set({ intents });
  },

  markPending: (id) => {
    const intents = get().intents.map((intent) =>
      intent.id === id ? { ...intent, status: 'pending' as const } : intent,
    );
    saveQueuedIntents(intents);
    set({ intents });
  },

  remapConversationRef: (fromRef, toRef) => {
    const intents = get().intents.map((intent) =>
      intent.localConversationRef === fromRef
        ? { ...intent, localConversationRef: toRef }
        : intent,
    );
    saveQueuedIntents(intents);

    const snapshots = { ...get().snapshots };
    if (snapshots[fromRef]) {
      snapshots[toRef] = snapshots[fromRef];
      delete snapshots[fromRef];
      persistSnapshots(snapshots);
    }

    set({ intents, snapshots });
  },

  getQueuedUserMessages: (localConversationRef) =>
    get()
      .intents
      .filter(
        (intent): intent is Extract<QueuedIntent, { type: 'send' }> =>
          intent.type === 'send' && intent.localConversationRef === localConversationRef,
      )
      .map((intent) => intent.userMessage),

  getPendingIntentsForRef: (localConversationRef) =>
    listPendingIntentsForRef(get().intents, localConversationRef),

  hydrateTaskLog: () => {
    const tasks = useTaskStore.getState().tasks;
    for (const intent of get().intents) {
      if (intent.status !== 'pending') continue;
      if (tasks.some((task) => task.id === intent.id)) continue;

      useTaskStore.getState().registerTask({
        id: intent.id,
        category: 'chat',
        title: intentTaskTitle(intent),
        detail: 'Waiting to connect',
        status: 'pending',
        conversationId: intent.localConversationRef,
        conversationTitle: intent.conversationTitle,
        cancellable: true,
        onAbort: () => get().remove(intent.id),
      });
    }
  },
}));