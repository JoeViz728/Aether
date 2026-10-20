import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import clsx from 'clsx';
import { queuedIntentDescription, resolveLocalConversationRef } from '../lib/intent-queue';
import { isDraftConversation } from '../lib/draft-conversation';
import { useAppStore } from '../store/app-store';
import { useIntentQueueStore } from '../store/intent-queue-store';
import { isActiveTask, useTaskStore } from '../store/task-store';
import { useVoice } from '../context/voice-context';
import { getChatWidthClass } from '../lib/chat-layout';
import { useChatScroll } from '../hooks/use-chat-scroll';
import { useMessageWindow } from '../hooks/use-message-window';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { TtsPlaybackBar } from './TtsPlaybackBar';
import { WelcomeScreen } from './WelcomeScreen';
import { ResponseOptionsDialog } from './ResponseOptionsDialog';
import { ConversationSettingsPanel } from './ConversationSettingsPanel';
import { ChatFlowchartButton } from './ChatFlowchartButton';
import { GeneratingResponsePlaceholder } from './GeneratingResponsePlaceholder';
import { MessageWindowChrome } from './MessageWindowChrome';

export function ChatArea() {
  const {
    activeConversation,
    activeConversationId,
    activePendingChatRef,
    streamingConversationId,
    isStreaming,
    streamingContent,
    streamingThinking,
    streamingToolCalls,
    streamingCitations,
    streamingAugmentations,
    streamingResponderName,
    streamingResponderType,
    selectedModel,
    apiKeyConfigured,
    error,
    sendMessage,
    initiateChat,
    pastePersonaGreeting,
    insertResponse,
    setSidebarOpen,
    settings,
    clearError,
    updateActiveConversation,
    pendingJump,
    clearPendingJump,
  } = useAppStore();

  const [insertDialogOpen, setInsertDialogOpen] = useState(false);

  // Only used to receive targets from the flowchart modal / global search. The actual scrolling
  // is delegated to useChatScroll.scrollToMessage (one-off jump, does not activate pinning).
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  // Briefly suppress fade-in animations right after a conversation navigation to reduce perceived jank
  // while avatars, markdown, and panels do their first layout.
  const [suppressMessageAnimations, setSuppressMessageAnimations] = useState(false);

  const { speakMessage } = useVoice();

  const queuedIntents = useIntentQueueStore((state) => state.intents);
  const isDraft = isDraftConversation(activeConversation, activeConversationId);
  const localConversationRef = resolveLocalConversationRef(
    activeConversationId,
    isDraft,
    activePendingChatRef,
  );

  const queuedUserMessages = useMemo(() => {
    if (!activeConversation) return [];
    return useIntentQueueStore.getState().getQueuedUserMessages(localConversationRef);
  }, [queuedIntents, activeConversation, localConversationRef]);

  const tasks = useTaskStore((state) => state.tasks);

  const isActiveConversationStreaming = Boolean(
    streamingConversationId &&
      activeConversationId &&
      streamingConversationId === activeConversationId &&
      !activePendingChatRef,
  );

  const activeChatTask = useMemo(
    () =>
      activeConversationId
        ? tasks.find(
            (task) =>
              task.category === 'chat' &&
              task.conversationId === activeConversationId &&
              isActiveTask(task),
          )
        : undefined,
    [tasks, activeConversationId],
  );

  const isConversationGenerating = isActiveConversationStreaming || Boolean(activeChatTask);

  const hasStreamPreview = Boolean(
    streamingContent ||
      streamingThinking.length > 0 ||
      streamingToolCalls.length > 0 ||
      streamingCitations.length > 0,
  );

  const showStreamPreview = isConversationGenerating && hasStreamPreview;
  const showGeneratingPlaceholder = isConversationGenerating && !hasStreamPreview;

  const generatingLabel = activeChatTask?.title ?? 'Generating response…';
  const generatingDetail = activeChatTask?.detail
    ?? (isActiveConversationStreaming && !isStreaming
      ? 'Still working in the background — output will appear here shortly.'
      : 'This may take a moment while tools or reasoning run.');

  const messages = activeConversation?.messages ?? [];

  // The latest user-authored turn (real or still queued). This is what we pin near the top
  // on send so that the growing response lives below it.
  const latestUserPromptId = useMemo(() => {
    if (messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) return lastUser.id;
    }
    if (queuedUserMessages.length > 0) {
      return queuedUserMessages[queuedUserMessages.length - 1].id;
    }
    return null;
  }, [messages, queuedUserMessages]);

  // === The single lean scroll controller ===
  const chatScroll = useChatScroll({ messages, latestUserPromptId });

  // Long-thread window: mount a slice of messages; expand on scroll / jump / load.
  const messageWindow = useMessageWindow({
    conversationKey: activeConversationId,
    messages,
    scrollRef: chatScroll.scrollRef,
  });

  // Track last visited convo.
  const lastVisitedConvoRef = useRef<string | null>(null);

  // On convo load, position to the bottom of the log *before the browser paints*.
  // This uses the fresh scroller (keyed by convo id) and direct scrollTop.
  // Result: no animation, no stabilize delay, no visible wrong position or sub-second "refresh".
  // Lands at the very bottom ("where left off"). If you prefer the head of the
  // latest user entry at top on load, we can switch the target later.
  useLayoutEffect(() => {
    if (!activeConversationId) return;
    if (lastVisitedConvoRef.current === activeConversationId) return;

    const container = chatScroll.scrollRef.current;
    if (container) {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    }
  }, [activeConversationId, chatScroll]);

  // Voice auto-read bookkeeping.
  const wasStreamingRef = useRef(false);
  const lastReadIdRef = useRef<string | null>(null);

  // On first arrival (or switch) to a conversation we just need to land instantly
  // at the bottom of the log ("where left off"). The useLayoutEffect above handles
  // the positioning before paint. No animation, no anchor on load (pinning only
  // on send), no stabilize, no sub-second correction or refresh.
  useEffect(() => {
    if (!activeConversationId) return;
    if (lastVisitedConvoRef.current === activeConversationId) return;

    lastVisitedConvoRef.current = activeConversationId;

    // Clear any previous pin state.
    chatScroll.releaseAnchor();

    // Suppress pop-in animations briefly for visual calm.
    setSuppressMessageAnimations(true);
    setTimeout(() => setSuppressMessageAnimations(false), 420);
  }, [activeConversationId, activeConversation, chatScroll]);

  // Consume search / deep-link jumps once the target conversation is active.
  const jumpToLatest = messageWindow.jumpToLatest;
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.conversationId !== activeConversationId) return;
    if (pendingJump.messageId) {
      setScrollToMessageId(pendingJump.messageId);
    } else {
      jumpToLatest();
    }
    clearPendingJump();
  }, [pendingJump, activeConversationId, clearPendingJump, jumpToLatest]);

  // Handle external "jump to this message" requests (flowchart / search).
  // Bring the message into the mounted window first, then scroll without pinning.
  const ensureMessageVisible = messageWindow.ensureMessageVisible;
  const scrollToMessage = chatScroll.scrollToMessage;
  useEffect(() => {
    if (!scrollToMessageId) return;

    const id = scrollToMessageId;
    ensureMessageVisible(id);

    // Defer until the window slice has committed to the DOM.
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        scrollToMessage(id, { behavior: 'smooth', block: 'center' });
      });
    });

    const t = setTimeout(() => setScrollToMessageId(null), 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scrollToMessageId, ensureMessageVisible, scrollToMessage]);

  // Voice: auto-read the last assistant message when generation finishes.
  useEffect(() => {
    if (wasStreamingRef.current && !isConversationGenerating && settings?.voice.autoReadResponses) {
      const lastAssistant = [...(activeConversation?.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant');

      if (lastAssistant && lastAssistant.id !== lastReadIdRef.current && lastAssistant.content.trim()) {
        lastReadIdRef.current = lastAssistant.id;
        speakMessage({
          messageId: lastAssistant.id,
          content: lastAssistant.content,
          conversationId: activeConversation?.id,
          conversationTitle: activeConversation?.title,
        });
      }
    }
    wasStreamingRef.current = isConversationGenerating;
  }, [isConversationGenerating, activeConversation?.messages, settings?.voice.autoReadResponses, speakMessage]);

  const handleSend = (text: string) => {
    // Fire-and-forget the send. Optimistic user message appears synchronously in the store.
    sendMessage(text);

    // Leave mid-history windows and land on the live tail so the new turn mounts.
    messageWindow.jumpToLatest();

    // Immediately pin the just-sent (or queued) user prompt head near the top of the viewport.
    // The hook will keep it there as the response streams and finally commits.
    // Using rAF + a store read guarantees the optimistic message id is present.
    requestAnimationFrame(() => {
      const state = useAppStore.getState();
      let targetId: string | null = null;

      const conv = state.activeConversation;
      if (conv?.messages?.length) {
        const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
        if (lastUser) targetId = lastUser.id;
      }
      if (!targetId) {
        const queued = useIntentQueueStore.getState().getQueuedUserMessages(localConversationRef);
        if (queued.length > 0) targetId = queued[queued.length - 1].id;
      }

      if (targetId) {
        messageWindow.ensureMessageVisible(targetId);
        chatScroll.scrollToAnchor(targetId, { behavior: 'auto' });
      }
    });
  };

  const pendingIntentsForRef = useMemo(
    () =>
      queuedIntents.filter(
        (intent) =>
          intent.localConversationRef === localConversationRef && intent.status === 'pending',
      ),
    [queuedIntents, localConversationRef],
  );

  const hasPendingIntents = pendingIntentsForRef.length > 0;

  const pendingRegenerations = useMemo(() => {
    const map = new Map<string, string>();
    for (const intent of pendingIntentsForRef) {
      if (intent.type === 'regenerate') {
        map.set(intent.messageId, queuedIntentDescription(intent));
      }
    }
    return map;
  }, [pendingIntentsForRef]);

  const pendingEdits = useMemo(() => {
    const map = new Map<string, string>();
    for (const intent of pendingIntentsForRef) {
      if (intent.type === 'edit') {
        map.set(intent.messageId, intent.content);
      }
    }
    return map;
  }, [pendingIntentsForRef]);

  const pendingInsert = pendingIntentsForRef.find((intent) => intent.type === 'insert');
  const pendingInitiate = pendingIntentsForRef.find((intent) => intent.type === 'initiate');

  const chatWidthClass = getChatWidthClass(settings?.chatWidth);
  const hasChatContent = Boolean(
    activeConversation &&
      (activeConversation.messages.length > 0 || queuedUserMessages.length > 0 || hasPendingIntents),
  );
  const isEmptyChat = !hasChatContent && !isConversationGenerating;
  const showPendingOnly = Boolean(
    hasPendingIntents &&
      activeConversation &&
      activeConversation.messages.length === 0 &&
      queuedUserMessages.length === 0,
  );
  const autoDictate = Boolean(
    settings?.voice.sttEnabled &&
      settings?.voice.dictationOnNewChat &&
      isEmptyChat &&
      !isConversationGenerating,
  );

  return (
    <main className="flex flex-1 flex-col min-w-0">
      <header
        className={clsx(
          'flex items-center gap-3 px-4 py-3 shrink-0',
          !isEmptyChat && 'border-b border-aether-border',
        )}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="rounded-lg p-2 text-aether-muted hover:text-aether-text md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {!isEmptyChat ? (
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium truncate">
              {activeConversation?.title ?? 'Aether'}
            </h2>
            {activeConversation?.settings.storyMode && (
              <p className="text-xs text-aether-muted truncate">Story</p>
            )}
            {isConversationGenerating && (
              <p className="text-xs text-aether-muted truncate flex items-center gap-1.5 mt-0.5">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                {generatingLabel}
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 min-w-0" />
        )}

        <ChatFlowchartButton
          conversation={activeConversation}
          disabled={isConversationGenerating}
          onNavigateToMessage={setScrollToMessageId}
        />
        <ConversationSettingsPanel
          conversation={activeConversation}
          onUpdate={updateActiveConversation}
          disabled={isConversationGenerating}
        />
      </header>

      <div key={activeConversationId} ref={chatScroll.scrollRef} className="flex-1 overflow-y-auto">
        {!apiKeyConfigured && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Configure your xAI API key in <code className="text-amber-200">.env</code> to start chatting.
          </div>
        )}

        {error && (
          <div className="mx-4 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex justify-between">
            <span>{error}</span>
            <button type="button" onClick={clearError} className="underline">Dismiss</button>
          </div>
        )}

        {isEmptyChat ? (
          <WelcomeScreen
            onSuggestion={handleSend}
            onInitiate={() => void initiateChat()}
            onPasteGreeting={(personaId, content) => void pastePersonaGreeting(personaId, content)}
          />
        ) : (
          <div
            ref={chatScroll.contentRef}
            className={clsx('mx-auto w-full space-y-6 p-4 pb-8', chatWidthClass)}
            style={{ paddingBottom: chatScroll.bottomPadding }}
          >
            {showPendingOnly && (
              <div className="rounded-xl border border-dashed border-amber-500/35 bg-amber-500/5 px-4 py-6 text-center animate-fade-in">
                <p className="text-sm font-medium text-aether-text">Queued — waiting to connect</p>
                <p className="mt-1.5 text-xs text-aether-muted leading-relaxed">
                  {pendingInitiate
                    ? queuedIntentDescription(pendingInitiate)
                    : 'This chat is saved locally and will submit automatically when Aether is reachable again.'}
                </p>
              </div>
            )}

            {messageWindow.range.hasEarlier && (
              <MessageWindowChrome
                direction="earlier"
                count={messageWindow.range.earlierCount}
                onLoad={messageWindow.loadEarlier}
              />
            )}

            {messages.slice(messageWindow.startIndex, messageWindow.range.end).map((msg, i) => {
              const index = messageWindow.startIndex + i;
              const editedContent = pendingEdits.get(msg.id);
              const displayMessage = editedContent ? { ...msg, content: editedContent } : msg;
              const editIntent = pendingIntentsForRef.find(
                (intent) => intent.type === 'edit' && intent.messageId === msg.id,
              );
              const queuedActionLabel = editedContent && editIntent
                ? queuedIntentDescription(editIntent)
                : pendingRegenerations.get(msg.id);

              return (
                <MessageBubble
                  key={msg.id}
                  message={displayMessage}
                  messageIndex={index}
                  isQueued={Boolean(editedContent)}
                  queuedActionLabel={queuedActionLabel}
                  suppressAnimation={suppressMessageAnimations}
                />
              );
            })}

            {messageWindow.range.hasLater && (
              <MessageWindowChrome
                direction="later"
                count={messageWindow.range.laterCount}
                onLoad={messageWindow.loadLater}
                onJumpLatest={messageWindow.jumpToLatest}
              />
            )}

            {queuedUserMessages.map((msg, index) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                messageIndex={messages.length + index}
                isQueued
                suppressAnimation={suppressMessageAnimations}
              />
            ))}

            {pendingInsert && (
              <MessageBubble
                message={{
                  id: `queued-insert-${pendingInsert.id}`,
                  role: 'assistant',
                  content: '',
                  createdAt: pendingInsert.createdAt,
                }}
                messageIndex={messages.length + queuedUserMessages.length}
                queuedActionLabel={queuedIntentDescription(pendingInsert)}
                suppressAnimation={suppressMessageAnimations}
              />
            )}

            {showStreamPreview && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  createdAt: new Date().toISOString(),
                  model: selectedModel ?? undefined,
                  thinking: streamingThinking,
                  toolCalls: streamingToolCalls,
                  citations: streamingCitations,
                  augmentations: streamingAugmentations,
                }}
                messageIndex={messages.length}
                isStreaming
                responderName={streamingResponderName ?? undefined}
                responderType={streamingResponderType ?? undefined}
                suppressAnimation={suppressMessageAnimations}
              />
            )}

            {showGeneratingPlaceholder && (
              <GeneratingResponsePlaceholder
                label={generatingLabel}
                detail={generatingDetail}
                toolCalls={streamingToolCalls}
              />
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-aether-border bg-aether-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <TtsPlaybackBar />
        <ChatInput
          onSend={(text) => void handleSend(text)}
          onInsertResponse={() => setInsertDialogOpen(true)}
          showInsertResponse={!isEmptyChat}
          disabled={isConversationGenerating || !apiKeyConfigured}
          placeholder={apiKeyConfigured ? 'Ask anything…' : 'Configure API key to chat'}
          autoDictate={autoDictate}
        />
      </footer>

      {insertDialogOpen && (
        <ResponseOptionsDialog
          title="Generate response"
          description={
            activeConversation?.settings.storyMode
              ? 'Insert a narrator response. Optionally focus context on a cast character (must be in scene cast).'
              : 'Insert a new assistant response at the end of this chat without replacing existing messages.'
          }
          confirmLabel="Generate"
          confirmingLabel="Generating…"
          storyMode={activeConversation?.settings.storyMode}
          castPersonaIds={activeConversation?.storyCastPersonaIds}
          onClose={() => setInsertDialogOpen(false)}
          onConfirm={async (opts) => {
            setInsertDialogOpen(false);
            await insertResponse(opts);
          }}
        />
      )}
    </main>
  );
}
