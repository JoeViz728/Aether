import { create } from 'zustand';
import type {
  AppSettings,
  ApprovalRequest,
  ChatMessage,
  Citation,
  Conversation,
  Persona,
  ResponderType,
  StreamEvent,
  TaskRecord,
  ThinkingBlock,
  Tool,
  ToolCallRecord,
  MessageAugmentation,
} from '@aether/shared';
import { isConversationUnread } from '@aether/shared';
import { api, type ConversationSummary } from '../lib/api';
import { choiceToRequest } from '../lib/chat-responder';
import {
  applySendTargetToConversation,
  parseSendTargetValue,
  sendTargetValueFromConversation,
  sendTargetValueFromSettings,
} from '../lib/send-target';
import * as offlineCache from '../lib/offline-cache';
import { isOfflineError, isSimulateOffline } from '../lib/offline-debug';
import { applyStreamEvent, INITIAL_STREAMING, type StreamingState } from '../lib/stream-events';
import {
  createStreamUiBatcher,
  shouldFlushStreamUiImmediately,
  type StreamUiBatcher,
} from '../lib/stream-ui-batcher';
import {
  conversationsWithContent,
  createDraftConversation,
  isDraftConversation,
} from '../lib/draft-conversation';
import { canReachServer, isClientOffline } from '../lib/client-offline';
import {
  createPendingChatRef,
  isPendingChatRef,
  needsServerMaterialize,
  resolveLocalConversationRef,
  type QueuedIntent,
} from '../lib/intent-queue';
import { useIntentQueueStore } from './intent-queue-store';
import { TERMINAL_TASK_STATUSES, useTaskStore } from './task-store';

let streamChain: Promise<void> = Promise.resolve();

function enqueueStreamWork<T>(work: () => Promise<T>): Promise<T> {
  const run = streamChain.then(work);
  streamChain = run.then(() => undefined).catch(() => undefined);
  return run;
}

function isViewingConversation(get: () => AppState, conversationId: string | undefined): boolean {
  if (!conversationId) return false;
  return get().activeConversationId === conversationId;
}

type MaterializeOpts = {
  model?: string;
  activePersonaId?: string | null;
  settings?: Partial<Conversation['settings']>;
};

interface AppState {
  initialized: boolean;
  apiKeyConfigured: boolean;
  settings: AppSettings | null;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  activePendingChatRef: string | null;
  streamingConversationId: string | null;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: ThinkingBlock[];
  streamingToolCalls: ToolCallRecord[];
  streamingCitations: Citation[];
  streamingAugmentations: MessageAugmentation[];
  selectedModel: string | null;
  sendTargetValue: string;
  modelSelectionReason: string | null;
  streamingResponderName: string | null;
  streamingResponderType: ResponderType | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  personasOpen: boolean;
  toolsOpen: boolean;
  personas: Persona[];
  tools: Tool[];
  pendingApprovals: ApprovalRequest[];
  error: string | null;
  availableModels: string[];

  initialize: () => Promise<void>;
  loadPersonas: () => Promise<void>;
  loadConversations: () => Promise<void>;
  openNewChatSetup: () => void;
  selectConversation: (id: string) => Promise<void>;
  selectPendingChat: (localConversationRef: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  initiateChat: (influencePrompt?: string) => Promise<void>;
  setSendTarget: (value: string) => Promise<void>;
  pastePersonaGreeting: (personaId: string, content: string) => Promise<void>;
  insertResponse: (opts?: {
    influencePrompt?: string;
    respondAs?: { type: ResponderType; id: string };
  }) => Promise<void>;
  regenerateMessage: (messageId: string, opts?: {
    influencePrompt?: string;
    respondAs?: { type: ResponderType; id: string };
  }) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  switchBranch: (parentMessageId: string, target: 'live' | string) => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  resolveApproval: (id: string, decision: 'approved' | 'denied') => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPersonasOpen: (open: boolean) => void;
  setToolsOpen: (open: boolean) => void;
  loadTools: () => Promise<void>;
  loadModels: () => Promise<void>;
  refreshModels: () => Promise<void>;
  updateActiveConversation: (patch: Partial<Conversation>) => Promise<void>;
  clearError: () => void;
  reconcileAfterTaskSync: (previousTasks: TaskRecord[]) => Promise<void>;
  flushIntentQueue: () => Promise<void>;
  /**
   * After opening a conversation from search (or similar), ChatArea consumes this
   * to scroll/window-jump to a specific message.
   */
  pendingJump: { conversationId: string; messageId?: string } | null;
  jumpToConversationMessage: (conversationId: string, messageId?: string) => Promise<void>;
  clearPendingJump: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  apiKeyConfigured: false,
  settings: null,
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  activePendingChatRef: null,
  streamingConversationId: null,
  isStreaming: false,
  ...INITIAL_STREAMING,
  sendTargetValue: 'auto',
  sidebarOpen: typeof window !== 'undefined' && window.innerWidth >= 768,
  settingsOpen: false,
  personasOpen: false,
  toolsOpen: false,
  personas: [],
  tools: [],
  pendingApprovals: [],
  error: null,
  pendingJump: null,
  availableModels: [],

  loadPersonas: async () => {
    try {
      const personas = await api.listPersonas();
      set({ personas });
    } catch {
      /* keep cached personas */
    }
  },

  loadTools: async () => {
    try {
      const tools = await api.listTools();
      set({ tools: Array.isArray(tools) ? tools : [] });
    } catch {
      /* keep previous / empty */
    }
  },

  loadModels: async () => {
    try {
      const { models } = await api.listModels();
      set({ availableModels: Array.isArray(models) ? models : [] });
    } catch {
      /* keep previous / empty */
    }
  },

  refreshModels: async () => {
    await get().loadModels();
  },

  initialize: async () => {
    try {
      const [health, settings, conversations, approvals, personas, modelsRes, toolsRes] = await Promise.all([
        api.health(),
        api.getSettings(),
        api.listConversations(),
        api.listApprovals(),
        api.listPersonas().catch(() => [] as Persona[]),
        api.listModels().catch(() => ({ models: [] as string[] })),
        api.listTools().catch(() => [] as Tool[]),
      ]);

      const listed = conversationsWithContent(conversations);

      offlineCache.saveBootstrap({
        settings,
        conversations: listed,
        apiKeyConfigured: health.apiKeyConfigured,
        approvals,
      });

      set({
        initialized: true,
        apiKeyConfigured: health.apiKeyConfigured,
        settings,
        conversations: listed,
        personas,
        tools: toolsRes ?? [],
        pendingApprovals: approvals,
        availableModels: modelsRes.models ?? [],
        error: null,
      });

      useIntentQueueStore.getState().hydrateTaskLog();
      get().openNewChatSetup();
    } catch (err) {
      const cached = offlineCache.loadBootstrap();
      if (cached) {
        const listed = conversationsWithContent(cached.conversations);
        set({
          initialized: true,
          apiKeyConfigured: cached.apiKeyConfigured,
          settings: cached.settings,
          conversations: listed,
          pendingApprovals: cached.approvals,
          tools: [],
          availableModels: [],
          error: isSimulateOffline()
            ? 'Simulated offline mode — showing cached data'
            : 'Offline — showing cached data',
        });

        useIntentQueueStore.getState().hydrateTaskLog();
        get().openNewChatSetup();
        return;
      }

      set({
        initialized: true,
        tools: [],
        availableModels: [],
        error: err instanceof Error ? err.message : 'Failed to initialize',
      });
      get().openNewChatSetup();
    }
  },

  loadConversations: async () => {
    try {
      const listed = conversationsWithContent(await api.listConversations());
      const conversations = mergeInProgressConversations(listed, get);
      offlineCache.saveConversations(conversations);
      set({ conversations });
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      const cached = offlineCache.loadBootstrap();
      if (cached) {
        set({
          conversations: mergeInProgressConversations(
            conversationsWithContent(cached.conversations),
            get,
          ),
        });
      }
    }
  },

  openNewChatSetup: () => {
    const settings = get().settings;
    const sendTargetValue = settings
      ? sendTargetValueFromSettings(settings)
      : 'auto';
    const draft = applySendTargetToConversation(
      createDraftConversation(settings?.defaultModel ?? 'grok-2'),
      sendTargetValue,
      settings,
      get().personas,
      false,
    );
    set({
      ...INITIAL_STREAMING,
      isStreaming: false,
      activeConversationId: null,
      activePendingChatRef: createPendingChatRef(),
      activeConversation: draft,
      selectedModel: draft.model,
      sendTargetValue,
      error: null,
    });
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      set({ sidebarOpen: false });
    }
  },

  selectPendingChat: (localConversationRef) => {
    const snapshot = useIntentQueueStore.getState().getConversationSnapshot(localConversationRef);
    const fallback = get().activeConversation ?? createDraftConversation(
      get().settings?.defaultModel ?? 'grok-2',
    );
    const conversation = snapshot ?? fallback;

    if (isPendingChatRef(localConversationRef)) {
      set({
        activeConversationId: null,
        activePendingChatRef: localConversationRef,
        activeConversation: conversation,
        isStreaming: false,
        ...INITIAL_STREAMING,
        selectedModel: conversation.model,
        sendTargetValue: sendTargetValueFromConversation(
          conversation,
          Boolean(conversation.settings.storyMode),
        ),
        error: null,
      });
      return;
    }

    const cached = snapshot ?? offlineCache.loadConversation(localConversationRef);
    if (!cached) return;

    set({
      activeConversationId: localConversationRef,
      activePendingChatRef: null,
      activeConversation: cached,
      isStreaming: get().streamingConversationId === localConversationRef,
      ...(get().streamingConversationId === localConversationRef ? {} : INITIAL_STREAMING),
      selectedModel: cached.model,
      sendTargetValue: sendTargetValueFromConversation(
        cached,
        Boolean(cached.settings.storyMode),
      ),
      error: null,
    });
  },

  selectConversation: async (id: string) => {
    const { streamingConversationId } = get();
    const viewingActiveStream = streamingConversationId === id;

    try {
      const conversation = await api.getConversation(id);
      offlineCache.saveConversation(conversation);
      set({
        activeConversationId: id,
        activePendingChatRef: null,
        activeConversation: conversation,
        isStreaming: viewingActiveStream,
        ...(viewingActiveStream ? {} : INITIAL_STREAMING),
        selectedModel: conversation.model,
        sendTargetValue: sendTargetValueFromConversation(
          conversation,
          Boolean(conversation.settings.storyMode),
        ),
      });
      // Mark read after open (skip while still streaming — complete handler will mark).
      if (!viewingActiveStream) {
        await markConversationRead(id, get, set);
      }
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      const conversation = offlineCache.loadConversation(id);
      if (!conversation) {
        set({ error: 'Conversation unavailable offline' });
        return;
      }
      conversation.lastReadAt = conversation.updatedAt;
      offlineCache.saveConversation(conversation);
      set({
        activeConversationId: id,
        activePendingChatRef: null,
        activeConversation: conversation,
        isStreaming: viewingActiveStream,
        ...(viewingActiveStream ? {} : INITIAL_STREAMING),
        selectedModel: conversation.model,
        sendTargetValue: sendTargetValueFromConversation(
          conversation,
          Boolean(conversation.settings.storyMode),
        ),
      });
      applyReadStateToSidebar(id, conversation, get, set);
    }
  },

  setSendTarget: async (value) => {
    const { activeConversation, activeConversationId, settings, personas } = get();
    if (!activeConversation) return;

    const storyMode = Boolean(activeConversation.settings.storyMode);
    const updated = applySendTargetToConversation(
      activeConversation,
      value,
      settings,
      personas,
      storyMode,
    );

    set({
      sendTargetValue: value,
      activeConversation: updated,
      selectedModel: updated.model,
    });

    if (!isDraftConversation(activeConversation, activeConversationId)) {
      const saved = await api.updateConversation(activeConversationId!, {
        model: updated.model,
        activePersonaId: updated.activePersonaId,
        settings: updated.settings,
      });
      offlineCache.saveConversation(saved);
      set({ activeConversation: saved });
    }
  },

  deleteConversation: async (id: string) => {
    await api.deleteConversation(id);
    const { activeConversationId } = get();
    await get().loadConversations();
    if (activeConversationId === id) {
      const conversations = get().conversations;
      if (conversations.length > 0) {
        await get().selectConversation(conversations[0].id);
      } else {
        get().openNewChatSetup();
      }
    }
  },

  sendMessage: async (content) => {
    const request = choiceToRequest(parseSendTargetValue(get().sendTargetValue));
    const { activeConversationId, activeConversation } = get();
    if (!activeConversation) return;

    const isDraft = isDraftConversation(activeConversation, activeConversationId);
    const userPersona = activeConversation.userPersonaId
      ? get().personas.find((persona) => persona.id === activeConversation.userPersonaId)
      : null;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      responderName: userPersona?.name,
      responderType: userPersona ? 'persona' : undefined,
      personaId: userPersona?.id,
    };

    if (isClientOffline()) {
      const needsMaterialize = isDraft || activeConversation.messages.length === 0;
      let pendingRef = get().activePendingChatRef;
      if (isDraft && !pendingRef) {
        pendingRef = createPendingChatRef();
      }
      const localRef = resolveLocalConversationRef(activeConversationId, isDraft, pendingRef);
      const titledConversation = {
        ...activeConversation,
        title: content.slice(0, 60) + (content.length > 60 ? '…' : ''),
      };
      useIntentQueueStore.getState().enqueue({
        id: crypto.randomUUID(),
        type: 'send',
        localConversationRef: localRef,
        conversationTitle: titledConversation.title,
        createdAt: new Date().toISOString(),
        status: 'pending',
        message: content,
        userMessage,
        model: request.model ?? get().selectedModel ?? undefined,
        personaId: request.personaId,
        settings: request.settings,
        draftMaterialize: needsMaterialize
          ? {
              model: request.model,
              activePersonaId: request.activePersonaId,
              settings: request.settings,
            }
          : undefined,
      }, { conversationSnapshot: titledConversation });
      set({
        error: null,
        activePendingChatRef: localRef,
        activeConversation: titledConversation,
      });
      get().selectPendingChat(localRef);
      return;
    }

    let conversationId: string;
    if (activeConversationId && activeConversation.messages.length > 0) {
      conversationId = activeConversationId;
    } else {
      conversationId = await materializeConversation(get, set, {
        model: request.model,
        activePersonaId: request.activePersonaId,
      });
    }

    const title = content.slice(0, 60) + (content.length > 60 ? '…' : '');
    let conversation = get().activeConversation;
    if (!conversation) return;

    conversation = {
      ...conversation,
      title,
      messages: [...conversation.messages, userMessage],
    };
    set({
      activeConversation: conversation,
      streamingConversationId: conversationId,
      isStreaming: true,
      ...INITIAL_STREAMING,
      error: null,
    });
    upsertConversationInSidebar(set, get, conversation, content.slice(0, 120));

    try {
      const saved = await api.updateConversation(conversationId, { title });
      offlineCache.saveConversation(saved);
      set({
        activeConversation: {
          ...conversation,
          ...saved,
          messages: conversation.messages,
        },
      });
      upsertConversationInSidebar(set, get, { ...conversation, ...saved }, content.slice(0, 120));
    } catch {
      /* title sync is best-effort; sidebar already has a local entry */
    }

    await processStream(
      (signal, taskId) =>
        api.streamChat({
          conversationId,
          message: content,
          model: request.model ?? get().selectedModel ?? undefined,
          personaId: request.personaId,
          settings: request.settings,
          taskId,
        }, signal),
      set,
      get,
      {
        title: 'Generating response',
        conversationId,
        conversationTitle: conversation.title,
      },
    );
  },

  initiateChat: async (influencePrompt) => {
    const draftConversation = get().activeConversation;
    if (!draftConversation) return;

    const storyMode = Boolean(draftConversation.settings.storyMode);
    const sendChoice = parseSendTargetValue(get().sendTargetValue);
    const request = storyMode && sendChoice.type === 'persona'
      ? choiceToRequest({ type: 'auto' })
      : choiceToRequest(sendChoice);

    if (isClientOffline()) {
      let pendingRef = get().activePendingChatRef;
      if (!pendingRef) {
        pendingRef = createPendingChatRef();
      }
      useIntentQueueStore.getState().enqueue({
        id: crypto.randomUUID(),
        type: 'initiate',
        localConversationRef: pendingRef,
        conversationTitle: draftConversation.title,
        createdAt: new Date().toISOString(),
        status: 'pending',
        influencePrompt,
        personaId: storyMode ? draftConversation.activePersonaId : request.personaId,
        model: request.model,
        settings: request.settings,
        draftMaterialize: {
          model: request.model,
          activePersonaId: storyMode ? draftConversation.activePersonaId : request.activePersonaId,
          settings: request.settings,
        },
      }, { conversationSnapshot: draftConversation });
      set({ error: null, activePendingChatRef: pendingRef });
      get().selectPendingChat(pendingRef);
      return;
    }

    const conversationId = await materializeConversation(get, set, {
      model: request.model,
      activePersonaId: storyMode ? draftConversation.activePersonaId : request.activePersonaId,
      settings: request.settings,
    });
    const activeConversation = get().activeConversation;
    if (!activeConversation) return;

    set({
      streamingConversationId: conversationId,
      isStreaming: true,
      ...INITIAL_STREAMING,
      error: null,
    });

    await processStream(
      (signal, taskId) =>
        api.streamInitiate({
          conversationId,
          personaId: storyMode ? draftConversation?.activePersonaId : request.personaId,
          model: request.model,
          influencePrompt,
          taskId,
        }, signal),
      set,
      get,
      {
        title: 'Initiating chat',
        conversationId,
        conversationTitle: activeConversation.title,
      },
    );
  },

  pastePersonaGreeting: async (personaId, content) => {
    const conversationId = await materializeConversation(get, set, { activePersonaId: personaId });
    const result = await api.seedConversationMessage(conversationId, { content, personaId });
    offlineCache.saveConversation(result.conversation);
    set({ activeConversation: result.conversation });
    await get().loadConversations();
  },

  insertResponse: async (opts) => {
    const { activeConversationId, activeConversation } = get();
    if (!activeConversationId || !activeConversation) return;

    if (isClientOffline()) {
      useIntentQueueStore.getState().enqueue({
        id: crypto.randomUUID(),
        type: 'insert',
        localConversationRef: activeConversationId,
        conversationTitle: activeConversation.title,
        createdAt: new Date().toISOString(),
        status: 'pending',
        influencePrompt: opts?.influencePrompt,
        respondAs: opts?.respondAs,
      }, { conversationSnapshot: activeConversation });
      set({ error: null });
      get().selectPendingChat(activeConversationId);
      return;
    }

    set({
      streamingConversationId: activeConversationId,
      isStreaming: true,
      ...INITIAL_STREAMING,
      error: null,
    });

    await processStream(
      (signal, taskId) =>
        api.streamInsert({
          conversationId: activeConversationId,
          influencePrompt: opts?.influencePrompt,
          respondAs: opts?.respondAs,
          taskId,
        }, signal),
      set,
      get,
      {
        title: 'Generating response',
        conversationId: activeConversationId,
        conversationTitle: activeConversation.title,
      },
    );
  },

  regenerateMessage: async (messageId, opts) => {
    const { activeConversationId, activeConversation } = get();
    if (!activeConversationId || !activeConversation) return;

    const index = activeConversation.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const parentIdx = index > 0 ? index - 1 : -1;

    const truncated = {
      ...activeConversation,
      messages: activeConversation.messages.slice(0, parentIdx + 1),
    };

    if (isClientOffline()) {
      set({ error: null });
      useIntentQueueStore.getState().enqueue({
        id: crypto.randomUUID(),
        type: 'regenerate',
        localConversationRef: activeConversationId,
        conversationTitle: activeConversation.title,
        createdAt: new Date().toISOString(),
        status: 'pending',
        messageId,
        influencePrompt: opts?.influencePrompt,
        respondAs: opts?.respondAs,
      }, { conversationSnapshot: activeConversation });
      return;
    }

    set({
      activeConversation: truncated,
      streamingConversationId: activeConversationId,
      isStreaming: true,
      ...INITIAL_STREAMING,
      error: null,
    });

    await processStream(
      (signal, taskId) =>
        api.streamRegenerate({
          conversationId: activeConversationId,
          messageId,
          taskId,
          influencePrompt: opts?.influencePrompt,
          respondAs: opts?.respondAs,
        }, signal),
      set,
      get,
      {
        title: 'Regenerating response',
        conversationId: activeConversationId,
        conversationTitle: activeConversation.title,
      },
    );
  },

  editMessage: async (messageId, content) => {
    const { activeConversationId, activeConversation } = get();
    if (!activeConversationId || !activeConversation) return;

    const index = activeConversation.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    const target = activeConversation.messages[index];
    const parentIdx = index > 0 ? index - 1 : -1;

    const truncated = {
      ...activeConversation,
      messages: activeConversation.messages.slice(0, parentIdx + 1),
    };

    if (isClientOffline()) {
      set({ error: null });
      useIntentQueueStore.getState().enqueue({
        id: crypto.randomUUID(),
        type: 'edit',
        localConversationRef: activeConversationId,
        conversationTitle: activeConversation.title,
        createdAt: new Date().toISOString(),
        status: 'pending',
        messageId,
        content,
      }, { conversationSnapshot: activeConversation });
      return;
    }

    set({
      activeConversation: truncated,
      streamingConversationId: activeConversationId,
      isStreaming: target.role === 'user',
      ...INITIAL_STREAMING,
      error: null,
    });

    await processStream(
      (signal, taskId) =>
        api.streamEdit({
          conversationId: activeConversationId,
          messageId,
          content,
          taskId,
        }, signal),
      set,
      get,
      {
        title: 'Editing message',
        conversationId: activeConversationId,
        conversationTitle: activeConversation.title,
      },
    );
  },

  switchBranch: async (parentMessageId, target) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    const conversation = await api.switchBranch(activeConversationId, parentMessageId, target);
    set({ activeConversation: conversation });
  },

  updateSettings: async (partial) => {
    const current = get().settings;
    if (!current) return;

    if (isSimulateOffline()) {
      const settings = { ...current, ...partial };
      offlineCache.saveSettings(settings);
      set({ settings });
      return;
    }

    try {
      const settings = await api.updateSettings(partial);
      offlineCache.saveSettings(settings);
      set({ settings });
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      const settings = { ...current, ...partial };
      offlineCache.saveSettings(settings);
      set({ settings, error: 'Offline — settings saved locally only' });
    }
  },

  resolveApproval: async (id, decision) => {
    await api.resolveApproval(id, decision);
    const approvals = await api.listApprovals();
    set({ pendingApprovals: approvals });
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setPersonasOpen: (open) => set({ personasOpen: open }),
  setToolsOpen: (open) => {
    set({ toolsOpen: open });
    if (open) {
      void get().loadTools();
    }
  },

  clearPendingJump: () => set({ pendingJump: null }),

  jumpToConversationMessage: async (conversationId, messageId) => {
    set({
      pendingJump: { conversationId, messageId },
      activePendingChatRef: null,
    });
    await get().selectConversation(conversationId);
  },

  updateActiveConversation: async (patch) => {
    const { activeConversationId, activeConversation } = get();
    if (!activeConversation) return;

    if (isDraftConversation(activeConversation, activeConversationId)) {
      const updated: Conversation = {
        ...activeConversation,
        ...patch,
        settings: patch.settings
          ? { ...activeConversation.settings, ...patch.settings }
          : activeConversation.settings,
        storyCastPersonaIds: patch.storyCastPersonaIds ?? activeConversation.storyCastPersonaIds,
      };
      const storyMode = Boolean(updated.settings.storyMode);
      let sendTargetValue = get().sendTargetValue;
      if (storyMode && sendTargetValue.startsWith('persona:')) {
        sendTargetValue = sendTargetValueFromConversation(updated, true);
      }
      set({
        activeConversation: updated,
        selectedModel: patch.model ?? get().selectedModel,
        sendTargetValue,
      });
      return;
    }

    const updated = await api.updateConversation(activeConversationId!, patch);
    offlineCache.saveConversation(updated);
    const storyMode = Boolean(updated.settings.storyMode);
    let sendTargetValue = sendTargetValueFromConversation(updated, storyMode);
    if (storyMode && get().sendTargetValue.startsWith('persona:')) {
      sendTargetValue = sendTargetValueFromConversation(updated, true);
    }
    set({
      activeConversation: updated,
      selectedModel: updated.model,
      sendTargetValue,
    });
  },

  clearError: () => set({ error: null }),

  reconcileAfterTaskSync: async (previousTasks) => {
    const { activeConversationId } = get();
    const tasks = useTaskStore.getState().tasks;
    const chatTasks = tasks.filter((task) => task.category === 'chat' && task.conversationId);

    let activeNeedsRefresh = false;
    let listNeedsRefresh = false;

    for (const task of chatTasks) {
      const prev = previousTasks.find((entry) => entry.id === task.id);
      const prevTerminal = prev ? TERMINAL_TASK_STATUSES.includes(prev.status) : false;
      const nowTerminal = TERMINAL_TASK_STATUSES.includes(task.status);
      const justFinished = !prevTerminal && nowTerminal;

      if (justFinished) {
        listNeedsRefresh = true;
        if (task.conversationId === activeConversationId) {
          activeNeedsRefresh = true;
        }
      }
    }

    if (
      activeConversationId &&
      !activeNeedsRefresh &&
      get().streamingConversationId !== activeConversationId
    ) {
      activeNeedsRefresh = chatTasks.some(
        (task) => task.conversationId === activeConversationId && task.status === 'running',
      );
    }

    if (!activeNeedsRefresh && !listNeedsRefresh) return;

    try {
      if (activeNeedsRefresh && activeConversationId) {
        const conversation = await api.getConversation(activeConversationId);
        offlineCache.saveConversation(conversation);
        set({ activeConversation: conversation });
        // Content arrived while this chat was open — treat as read.
        await markConversationRead(activeConversationId, get, set);
      }
      if (listNeedsRefresh || activeNeedsRefresh) {
        await get().loadConversations();
      }
    } catch (err) {
      if (!isOfflineError(err)) {
        set({ error: err instanceof Error ? err.message : 'Failed to refresh conversation' });
      }
    }
  },

  flushIntentQueue: async () => {
    if (!canReachServer()) return;

    const queue = useIntentQueueStore.getState();
    const pending = queue.getPending();
    if (pending.length === 0) return;

    const refMap = new Map<string, string>();

    for (const intent of pending) {
      if (!canReachServer()) break;

      queue.markSubmitting(intent.id);
      useTaskStore.getState().updateTask(intent.id, {
        status: 'running',
        detail: 'Submitting…',
      });

      try {
        let conversationId = intent.localConversationRef;
        if (needsServerMaterialize(conversationId)) {
          if (!refMap.has(conversationId)) {
            const materializeOpts = intent.type === 'send'
              ? intent.draftMaterialize
              : intent.type === 'initiate'
                ? intent.draftMaterialize
                : undefined;
            const snapshot = queue.getConversationSnapshot(conversationId)
              ?? createDraftConversation(get().settings?.defaultModel ?? 'grok-2');
            const createdId = await materializePendingConversation(snapshot, get, materializeOpts);
            refMap.set(conversationId, createdId);
            queue.remapConversationRef(conversationId, createdId);

            for (const task of useTaskStore.getState().tasks) {
              if (task.conversationId === conversationId) {
                useTaskStore.getState().updateTask(task.id, { conversationId: createdId });
              }
            }

            if (get().activePendingChatRef === conversationId) {
              const conversation = await api.getConversation(createdId);
              offlineCache.saveConversation(conversation);
              set({
                activePendingChatRef: null,
                activeConversationId: createdId,
                activeConversation: conversation,
              });
              upsertConversationInSidebar(set, get, conversation);
            }

            useTaskStore.getState().updateTask(intent.id, {
              conversationId: createdId,
            });
            await get().loadConversations();
          }
          conversationId = refMap.get(conversationId)!;
        } else if (intent.type === 'send' && intent.draftMaterialize) {
          conversationId = await materializeConversationById(conversationId, get, set, intent.draftMaterialize);
        }

        applyLocalTruncationForIntent(intent, get, set);
        await executeQueuedIntent(intent, conversationId, set, get);
        queue.remove(intent.id);
      } catch (err) {
        if (isOfflineError(err) || isClientOffline()) {
          queue.markPending(intent.id);
          useTaskStore.getState().updateTask(intent.id, {
            status: 'pending',
            detail: 'Waiting to connect',
          });
          break;
        }

        const message = err instanceof Error ? err.message : 'Queued action failed';
        useTaskStore.getState().failTask(intent.id, message);
        queue.remove(intent.id);
      }
    }
  },
}));

function applyLocalTruncationForIntent(
  intent: QueuedIntent,
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
): void {
  if (intent.type !== 'regenerate' && intent.type !== 'edit') return;

  const { activeConversationId, activeConversation } = get();
  if (!activeConversation || activeConversationId !== intent.localConversationRef) return;

  const index = activeConversation.messages.findIndex((message) => message.id === intent.messageId);
  if (index < 0) return;

  const parentIdx = index > 0 ? index - 1 : -1;
  set({
    activeConversation: {
      ...activeConversation,
      messages: activeConversation.messages.slice(0, parentIdx + 1),
    },
  });
}

function conversationToSummary(conversation: Conversation, preview = ''): ConversationSummary {
  const userPreview =
    conversation.messages.find((message) => message.role === 'user')?.content.slice(0, 120) ?? '';
  const lastReadAt = conversation.lastReadAt;
  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastReadAt,
    messageCount: conversation.messages.length,
    preview: preview || userPreview,
    unread: isConversationUnread({
      messageCount: conversation.messages.length,
      updatedAt: conversation.updatedAt,
      lastReadAt,
    }),
  };
}

function applyReadStateToSidebar(
  conversationId: string,
  conversation: Conversation,
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
): void {
  const conversations = get().conversations.map((entry) =>
    entry.id === conversationId
      ? {
          ...entry,
          lastReadAt: conversation.lastReadAt,
          updatedAt: conversation.updatedAt,
          unread: false,
        }
      : entry,
  );
  set({ conversations });
  offlineCache.saveConversations(conversations);
}

async function markConversationRead(
  conversationId: string,
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
): Promise<void> {
  if (!conversationId) return;

  try {
    const conversation = await api.markConversationRead(conversationId);
    offlineCache.saveConversation(conversation);
    if (get().activeConversationId === conversationId) {
      set({ activeConversation: conversation });
    }
    applyReadStateToSidebar(conversationId, conversation, get, set);
  } catch (err) {
    if (!isOfflineError(err)) return;
    const conversation =
      (get().activeConversationId === conversationId ? get().activeConversation : null) ??
      offlineCache.loadConversation(conversationId);
    if (!conversation) return;
    conversation.lastReadAt = conversation.updatedAt;
    offlineCache.saveConversation(conversation);
    if (get().activeConversationId === conversationId) {
      set({ activeConversation: conversation });
    }
    applyReadStateToSidebar(conversationId, conversation, get, set);
  }
}

function upsertConversationInSidebar(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  conversation: Conversation,
  preview = '',
): void {
  if (!conversation.id) return;
  const summary = conversationToSummary(conversation, preview);
  const conversations = [
    summary,
    ...get().conversations.filter((entry) => entry.id !== summary.id),
  ];
  set({ conversations });
  offlineCache.saveConversations(conversations);
}

function mergeInProgressConversations(
  listed: ConversationSummary[],
  get: () => AppState,
): ConversationSummary[] {
  const { activeConversationId, activeConversation, streamingConversationId } = get();
  if (!activeConversationId || !activeConversation?.id) return listed;
  if (listed.some((entry) => entry.id === activeConversationId)) return listed;

  const inProgress =
    streamingConversationId === activeConversationId ||
    activeConversation.messages.length === 0;
  if (!inProgress) return listed;

  return [conversationToSummary(activeConversation), ...listed];
}

async function materializeConversationById(
  conversationId: string,
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  opts?: MaterializeOpts,
): Promise<string> {
  let conversation = offlineCache.loadConversation(conversationId);
  if (!conversation) {
    conversation = await api.getConversation(conversationId);
    offlineCache.saveConversation(conversation);
  }

  if (conversation.messages.length > 0) {
    return conversationId;
  }

  const patch: Partial<Conversation> = {};
  if (opts?.model) patch.model = opts.model;
  if (opts && 'activePersonaId' in opts) {
    patch.activePersonaId = opts.activePersonaId ?? undefined;
  }
  if (opts?.settings) {
    patch.settings = { ...conversation.settings, ...opts.settings };
  }

  const updated = await api.updateConversation(conversationId, patch);
  offlineCache.saveConversation(updated);

  if (get().activeConversationId === conversationId) {
    set({
      activeConversation: updated,
      selectedModel: updated.model,
    });
  }

  return conversationId;
}

async function materializePendingConversation(
  snapshot: Conversation,
  get: () => AppState,
  opts?: MaterializeOpts,
): Promise<string> {
  const { settings, personas, sendTargetValue } = get();
  const draft = applySendTargetToConversation(
    snapshot,
    sendTargetValue,
    settings,
    personas,
    Boolean(snapshot.settings.storyMode),
  );

  const created = await api.createConversation({
    model: opts?.model ?? draft.model ?? settings?.defaultModel ?? 'grok-2',
    activePersonaId: opts?.activePersonaId ?? draft.activePersonaId,
  });

  const final = await api.updateConversation(created.id, {
    userPersonaId: draft.userPersonaId,
    storyCastPersonaIds: draft.storyCastPersonaIds ?? [],
    settings: {
      ...draft.settings,
      ...opts?.settings,
    },
  });

  offlineCache.saveConversation(final);
  return final.id;
}

async function materializeConversation(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  opts?: MaterializeOpts,
): Promise<string> {
  const { activeConversationId, activeConversation, settings } = get();

  if (activeConversationId && activeConversation) {
    if (activeConversation.messages.length === 0) {
      const patch: Partial<Conversation> = {};
      if (opts?.model) patch.model = opts.model;
      if (opts && 'activePersonaId' in opts) {
        patch.activePersonaId = opts.activePersonaId ?? undefined;
      }
      if (opts?.settings) {
        patch.settings = { ...activeConversation.settings, ...opts.settings };
      }
      const updated = await api.updateConversation(activeConversationId, patch);
      set({
        activeConversation: updated,
        selectedModel: updated.model,
      });
      upsertConversationInSidebar(set, get, updated);
      return updated.id;
    }
    return activeConversationId;
  }

  const draftBase = activeConversation ?? createDraftConversation(settings?.defaultModel ?? 'grok-2');
  const draft = applySendTargetToConversation(
    draftBase,
    get().sendTargetValue,
    settings,
    get().personas,
    Boolean(draftBase.settings.storyMode),
  );
  const created = await api.createConversation({
    model: opts?.model ?? draft.model ?? settings?.defaultModel,
    activePersonaId: opts?.activePersonaId ?? draft.activePersonaId,
  });

  const final = await api.updateConversation(created.id, {
    userPersonaId: draft.userPersonaId,
    storyCastPersonaIds: draft.storyCastPersonaIds ?? [],
    settings: {
      ...draft.settings,
      ...opts?.settings,
    },
  });

  set({
    activeConversationId: final.id,
    activeConversation: final,
    activePendingChatRef: null,
    selectedModel: final.model,
  });
  upsertConversationInSidebar(set, get, final);
  return final.id;
}

async function executeQueuedIntent(
  intent: QueuedIntent,
  conversationId: string,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<void> {
  const taskMeta = {
    title: intent.type === 'send'
      ? 'Generating response'
      : intent.type === 'initiate'
        ? 'Initiating chat'
        : intent.type === 'insert'
          ? 'Generating response'
          : intent.type === 'regenerate'
            ? 'Regenerating response'
            : 'Editing message',
    conversationId,
    conversationTitle: intent.conversationTitle,
  };

  switch (intent.type) {
    case 'send':
      await processStream(
        (signal, taskId) =>
          api.streamChat({
            conversationId,
            message: intent.message,
            model: intent.model,
            personaId: intent.personaId,
            settings: intent.settings,
            taskId,
          }, signal),
        set,
        get,
        taskMeta,
        { taskId: intent.id },
      );
      return;
    case 'initiate':
      await processStream(
        (signal, taskId) =>
          api.streamInitiate({
            conversationId,
            personaId: intent.personaId,
            model: intent.model,
            influencePrompt: intent.influencePrompt,
            taskId,
          }, signal),
        set,
        get,
        taskMeta,
        { taskId: intent.id },
      );
      return;
    case 'insert':
      await processStream(
        (signal, taskId) =>
          api.streamInsert({
            conversationId,
            influencePrompt: intent.influencePrompt,
            respondAs: intent.respondAs,
            taskId,
          }, signal),
        set,
        get,
        taskMeta,
        { taskId: intent.id },
      );
      return;
    case 'regenerate':
      await processStream(
        (signal, taskId) =>
          api.streamRegenerate({
            conversationId,
            messageId: intent.messageId,
            taskId,
            influencePrompt: intent.influencePrompt,
            respondAs: intent.respondAs,
          }, signal),
        set,
        get,
        taskMeta,
        { taskId: intent.id },
      );
      return;
    case 'edit':
      await processStream(
        (signal, taskId) =>
          api.streamEdit({
            conversationId,
            messageId: intent.messageId,
            content: intent.content,
            taskId,
          }, signal),
        set,
        get,
        taskMeta,
        { taskId: intent.id },
      );
      return;
  }
}

async function processStream(
  createStream: (signal: AbortSignal, taskId: string) => AsyncGenerator<StreamEvent>,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  taskMeta?: { title: string; conversationId: string; conversationTitle?: string },
  options?: { taskId?: string },
) {
  return enqueueStreamWork(async () => {
    let streamState = { ...INITIAL_STREAMING };
    const abortController = new AbortController();
    const taskId = options?.taskId ?? crypto.randomUUID();
    const streamConversationId = taskMeta?.conversationId ?? null;

    if (streamConversationId) {
      set({ streamingConversationId: streamConversationId });
      if (isViewingConversation(get, streamConversationId)) {
        set({ isStreaming: true, ...INITIAL_STREAMING });
      }
    }

    if (taskMeta) {
      const existing = useTaskStore.getState().tasks.find((task) => task.id === taskId);
      if (existing) {
        const handlers = new Map(useTaskStore.getState().abortHandlers);
        handlers.set(taskId, () => abortController.abort());
        useTaskStore.setState({ abortHandlers: handlers });
        useTaskStore.getState().updateTask(taskId, {
          status: 'running',
          detail: undefined,
          conversationId: taskMeta.conversationId,
          conversationTitle: taskMeta.conversationTitle,
        });
      } else {
        useTaskStore.getState().registerTask({
          id: taskId,
          category: 'chat',
          title: taskMeta.title,
          conversationId: taskMeta.conversationId,
          conversationTitle: taskMeta.conversationTitle,
          cancellable: true,
          onAbort: () => abortController.abort(),
        });
      }
    }

    let uiBatcher: StreamUiBatcher | null = null;

    const disposeStreamUi = () => {
      if (!uiBatcher) return;
      uiBatcher.dispose();
      uiBatcher = null;
    };

    const pushStreamUi = (state: StreamingState, immediate = false) => {
      if (!isViewingConversation(get, streamConversationId ?? undefined)) return;
      if (!uiBatcher) {
        uiBatcher = createStreamUiBatcher((next) => set({ ...next, isStreaming: true }));
      }
      if (immediate) uiBatcher.flushNow(state);
      else uiBatcher.schedule(state);
    };

    try {
      const stream = createStream(abortController.signal, taskId);

      for await (const event of stream) {
        if (abortController.signal.aborted) break;

        if (event.type === 'error') {
          const { message } = event.data as { message: string };
          if (isViewingConversation(get, streamConversationId ?? undefined)) {
            disposeStreamUi();
            set({ error: message });
          }
          continue;
        }

        const patch = applyStreamEvent(streamState, event);
        if (patch) {
          if (typeof patch === 'function') {
            streamState = { ...streamState, ...patch(streamState) };
          } else if (!('error' in patch)) {
            streamState = { ...streamState, ...patch };
          }
          pushStreamUi(streamState, shouldFlushStreamUiImmediately(event.type));
        }

        if (event.type === 'approval_required') {
          pushStreamUi(streamState, true);
          const approvals = await api.listApprovals();
          set({ pendingApprovals: approvals });
        }
      }

      disposeStreamUi();

      if (!abortController.signal.aborted) {
        const refreshId = taskMeta?.conversationId ?? get().activeConversationId;
        if (refreshId) {
          const conversation = await api.getConversation(refreshId);
          offlineCache.saveConversation(conversation);
          if (get().activeConversationId === refreshId) {
            set({ activeConversation: conversation });
            // User watched (or is watching) this chat — clear unread.
            await markConversationRead(refreshId, get, set);
          } else {
            // Background completion: leave unread for sidebar (updatedAt > lastReadAt).
            upsertConversationInSidebar(set, get, conversation);
          }
          await get().loadConversations();
        }
      }
    } catch (err) {
      disposeStreamUi();
      const message = err instanceof Error ? err.message : 'Request failed';
      if (!abortController.signal.aborted && isViewingConversation(get, streamConversationId ?? undefined)) {
        set({ error: message });
      }
    } finally {
      disposeStreamUi();
      if (get().streamingConversationId === streamConversationId) {
        set({ streamingConversationId: null });
      }
      if (isViewingConversation(get, streamConversationId ?? undefined)) {
        set({ isStreaming: false, ...INITIAL_STREAMING });
      }

      if (taskMeta) {
        const previousTasks = useTaskStore.getState().tasks;
        void useTaskStore.getState().syncFromServer().then(() => {
          void get().reconcileAfterTaskSync(previousTasks);
        });
      }
    }
  });
}