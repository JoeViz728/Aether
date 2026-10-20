import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Settings,
  X,
  UserCircle,
  ListTodo,
  Loader2,
  Clock,
  Volume2,
  MoreVertical,
  Ban,
  Wrench,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { DRAFT_CONVERSATION_REF } from '../lib/client-offline';
import { isDraftConversation } from '../lib/draft-conversation';
import { useAppStore } from '../store/app-store';
import { useIntentQueueStore } from '../store/intent-queue-store';
import {
  getConversationTaskIndicator,
  isActiveTask,
  type ConversationTaskIndicator,
  useTaskStore,
} from '../store/task-store';
import { useSearchSessionStore } from '../store/search-session-store';
import { useVoice } from '../context/voice-context';

function ConversationStatusIcons({
  taskIndicator,
  hasTtsBarOpen,
  isTtsPlaying,
}: {
  taskIndicator: ConversationTaskIndicator | null;
  hasTtsBarOpen: boolean;
  isTtsPlaying: boolean;
}) {
  if (!taskIndicator && !hasTtsBarOpen) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5" aria-label="Chat status">
      {taskIndicator === 'running' && (
        <Loader2
          className="h-3.5 w-3.5 text-aether-muted animate-spin"
          aria-label="Task running"
        />
      )}
      {taskIndicator === 'pending' && (
        <Clock className="h-3.5 w-3.5 text-aether-muted" aria-label="Task queued" />
      )}
      {hasTtsBarOpen && (
        <Volume2
          className={clsx(
            'h-3.5 w-3.5 text-aether-muted',
            isTtsPlaying && 'animate-pulse',
          )}
          aria-label="TTS playback bar open"
        />
      )}
    </div>
  );
}

function ConversationOverflowMenu({
  isOpen,
  onOpen,
  onClose,
  onDelete,
}: {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  return (
    <div
      className={clsx(
        'absolute right-1.5 top-1/2 z-10 -translate-y-1/2',
        isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
      )}
      ref={menuRef}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) onClose();
          else onOpen();
        }}
        className="rounded p-1 text-aether-muted transition-colors hover:bg-aether-surface-2 hover:text-aether-text"
        aria-label="Chat options"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] rounded-lg border border-aether-border bg-aether-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-aether-surface-2 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete chat
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const {
    conversations,
    activeConversation,
    activeConversationId,
    activePendingChatRef,
    streamingConversationId,
    sidebarOpen,
    openNewChatSetup,
    selectConversation,
    selectPendingChat,
    deleteConversation,
    setSidebarOpen,
    setSettingsOpen,
    setPersonasOpen,
    setToolsOpen,
  } = useAppStore();
  const queuedIntents = useIntentQueueStore((s) => s.intents);
  const pendingSidebarChats = useMemo(
    () => useIntentQueueStore.getState().getPendingSidebarChats(
      conversations.map((conversation) => conversation.id),
    ),
    [queuedIntents, conversations],
  );
  const cancelPendingChat = useIntentQueueStore((s) => s.cancelPendingChat);
  const tasks = useTaskStore((s) => s.tasks);
  const setTasksOpen = useTaskStore((s) => s.setTasksOpen);
  const activeTaskCount = useTaskStore((s) => s.tasks.filter(isActiveTask).length);
  const queuedTaskCount = useTaskStore((s) => s.tasks.filter((task) => task.status === 'pending').length);
  const { playback } = useVoice();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const ttsBarConversationId = playback?.conversationId ?? null;
  const isPendingChatActive = (localConversationRef: string) =>
    activePendingChatRef === localConversationRef ||
    (localConversationRef === DRAFT_CONVERSATION_REF &&
      isDraftConversation(activeConversation, activeConversationId) &&
      useIntentQueueStore.getState().hasPendingForRef(localConversationRef));

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-aether-overlay md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-aether-border bg-aether-surface transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-semibold tracking-tight">Aether</h1>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 space-y-2">
          <button
            type="button"
            onClick={() => openNewChatSetup()}
            className="flex w-full items-center gap-2 rounded-xl border border-aether-border px-4 py-2.5 text-sm font-medium hover:bg-aether-surface-2 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
          <button
            type="button"
            onClick={() => useSearchSessionStore.getState().setOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-aether-border px-4 py-2.5 text-sm text-aether-muted hover:text-aether-text hover:bg-aether-surface-2 transition-colors"
          >
            <Search className="h-4 w-4" />
            Search chats
          </button>
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto px-3">
          {pendingSidebarChats.map((pending) => {
            const taskIndicator = getConversationTaskIndicator(
              pending.localConversationRef,
              tasks,
              streamingConversationId,
            );

            return (
              <div
                key={`pending-${pending.localConversationRef}`}
                className={clsx(
                  'group relative flex items-center gap-2 rounded-lg px-3 py-2.5 mb-0.5 cursor-pointer transition-colors border border-dashed border-amber-500/30',
                  isPendingChatActive(pending.localConversationRef)
                    ? 'bg-aether-surface-2 text-aether-text'
                    : 'text-aether-muted hover:bg-aether-surface-2/50 hover:text-aether-text',
                )}
                onClick={() => {
                  setOpenMenuId(null);
                  selectPendingChat(pending.localConversationRef);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
              >
                <ConversationStatusIcons
                  taskIndicator={taskIndicator ?? 'pending'}
                  hasTtsBarOpen={false}
                  isTtsPlaying={false}
                />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{pending.title}</span>
                  <span className="block truncate text-[11px] text-amber-400/80">
                    Queued — waiting to connect
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const wasActive = isPendingChatActive(pending.localConversationRef);
                    cancelPendingChat(pending.localConversationRef);
                    if (!wasActive) return;
                    const remaining = useAppStore.getState().conversations;
                    if (remaining.length > 0) {
                      void selectConversation(remaining[0].id);
                    } else {
                      openNewChatSetup();
                    }
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-aether-muted opacity-0 transition-opacity hover:bg-aether-surface-2 hover:text-aether-text group-hover:opacity-100"
                  title="Cancel queued chat"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {conversations.map((conv) => {
            const taskIndicator = getConversationTaskIndicator(
              conv.id,
              tasks,
              streamingConversationId,
            );
            const hasTtsBarOpen = ttsBarConversationId === conv.id;
            const isTtsPlaying = hasTtsBarOpen && Boolean(playback?.isPlaying || playback?.isPreparing);

            return (
              <div
                key={conv.id}
                className={clsx(
                  'group relative flex items-center gap-2 rounded-lg px-3 py-2.5 mb-0.5 cursor-pointer transition-colors',
                  activeConversationId === conv.id
                    ? 'bg-aether-surface-2 text-aether-text'
                    : 'text-aether-muted hover:bg-aether-surface-2/50 hover:text-aether-text',
                )}
                onClick={() => {
                  setOpenMenuId(null);
                  selectConversation(conv.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
              >
                <ConversationStatusIcons
                  taskIndicator={taskIndicator}
                  hasTtsBarOpen={hasTtsBarOpen}
                  isTtsPlaying={isTtsPlaying}
                />
                {conv.unread && activeConversationId !== conv.id && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-aether-accent"
                    aria-label="Unread"
                    title="Unread"
                  />
                )}
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate text-sm',
                    openMenuId === conv.id ? 'pr-6' : 'group-hover:pr-6',
                    conv.unread && activeConversationId !== conv.id && 'font-semibold text-aether-text',
                  )}
                >
                  {conv.title}
                </span>
                <ConversationOverflowMenu
                  isOpen={openMenuId === conv.id}
                  onOpen={() => setOpenMenuId(conv.id)}
                  onClose={() => setOpenMenuId(null)}
                  onDelete={() => void deleteConversation(conv.id)}
                />
              </div>
            );
          })}
        </nav>

        <div className="border-t border-aether-border p-3 space-y-0.5">
          <button
            type="button"
            onClick={() => setTasksOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          >
            <ListTodo className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Tasks</span>
            {(activeTaskCount > 0 || queuedTaskCount > 0) && (
              <span className="rounded-full bg-aether-text px-1.5 py-0.5 text-[10px] font-semibold text-aether-bg">
                {activeTaskCount + queuedTaskCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          >
            <Wrench className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Tools &amp; Automation</span>
          </button>
          <button
            type="button"
            onClick={() => setPersonasOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          >
            <UserCircle className="h-4 w-4" />
            Personas
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
        </div>
      </aside>
    </>
  );
}