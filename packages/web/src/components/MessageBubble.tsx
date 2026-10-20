import { User, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { formatMessageTime, getModelById, getPersonaAvatarSrc } from '@aether/shared';
import type { ChatMessage, Persona } from '@aether/shared';
import { ThinkingPanel } from './ThinkingPanel';
import { MessageActions } from './MessageActions';
import { BranchSwitcher } from './BranchSwitcher';
import { MarkdownContent } from './MarkdownContent';
import { getParentMessageId, hasBranchVariants, isFirstMessageAfterParent } from '../lib/branches';
import { getMessageBubbleClass, getMessagePaddingClass } from '../lib/chat-layout';
import { useAppStore } from '../store/app-store';
import { MessageAugmentations } from './notes/NotesAugmentationCard';

interface Props {
  message: ChatMessage;
  messageIndex: number;
  isStreaming?: boolean;
  isQueued?: boolean;
  queuedActionLabel?: string;
  responderName?: string;
  responderType?: 'model' | 'persona';
  /** When true, omit the fade-in animation (used during convo navigation settle). */
  suppressAnimation?: boolean;
}

function getDisplayName(message: ChatMessage, override?: string): string {
  if (override) return override;
  if (message.responderName) return message.responderName;
  if (message.model) return getModelById(message.model)?.label ?? message.model;
  return message.role === 'user' ? 'You' : 'Aether';
}

function MessageAvatar({ isUser, persona }: { isUser: boolean; persona?: Persona | null }) {
  const avatarSrc = persona ? getPersonaAvatarSrc(persona) : null;

  if (avatarSrc) {
    return (
      <div className="flex h-10 w-10 shrink-0 overflow-hidden rounded-full border border-aether-border">
        {/* Eager + decode helps reduce layout/paint shifts when switching conversations */}
        <img
          src={avatarSrc}
          alt=""
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        isUser ? 'bg-aether-surface-2' : 'bg-aether-accent text-aether-bg',
      )}
    >
      {isUser ? <User className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
    </div>
  );
}

export function MessageBubble({
  message,
  messageIndex,
  isStreaming,
  isQueued,
  queuedActionLabel,
  responderName,
  responderType,
  suppressAnimation,
}: Props) {
  const activeConversation = useAppStore((s) => s.activeConversation);
  const settings = useAppStore((s) => s.settings);
  const personas = useAppStore((s) => s.personas);
  const isUser = message.role === 'user';

  // Determine persona for avatar (for user persona or persona responses)
  let avatarPersona: Persona | undefined;
  if (isUser) {
    const pid = message.personaId ?? activeConversation?.userPersonaId;
    if (pid) avatarPersona = personas.find((p) => p.id === pid);
  } else if ((responderType ?? message.responderType) === 'persona') {
    const pid = message.personaId;
    if (pid) avatarPersona = personas.find((p) => p.id === pid);
  }

  // Deleted persona behavior:
  // - Messages persist responderName, personaId, and responderType from the time they were created.
  // - If the referenced persona no longer exists in the current personas list (or its avatar file was deleted):
  //   - displayName will still use the stored responderName (historical name is preserved).
  //   - avatarPersona will be undefined → falls back to default icon (User / Sparkles).
  //   - subtitle for assistants will still say "Persona" if responderType was 'persona'.
  //   - No UI breakage; chats remain readable with the name at the time of the message.
  const showQueuedState = isQueued || Boolean(queuedActionLabel);
  const parentMessageId = activeConversation
    ? getParentMessageId(activeConversation, messageIndex)
    : null;
  const showBranchSwitcher = Boolean(
    activeConversation &&
    parentMessageId &&
    isFirstMessageAfterParent(activeConversation, messageIndex) &&
    hasBranchVariants(activeConversation, parentMessageId),
  );
  const userPersonaName = activeConversation?.userPersonaId
    ? personas.find((p) => p.id === activeConversation.userPersonaId)?.name
    : undefined;
  const displayName = isUser
    ? (message.responderName ?? userPersonaName ?? 'You')
    : getDisplayName(message, responderName);
  const subtitle = !isUser && (responderType ?? message.responderType) === 'persona'
    ? 'Persona'
    : !isUser && message.model
      ? getModelById(message.model)?.label ?? message.model
      : undefined;
  const timestamp = message.createdAt ? formatMessageTime(message.createdAt) : null;
  const hasThinkingTrace =
    (message.thinking && message.thinking.length > 0) ||
    (message.toolCalls && message.toolCalls.length > 0);

  return (
    <div className={clsx('w-full', !suppressAnimation && 'animate-fade-in')} data-message-id={message.id}>
      {isUser ? (
        <div className="mb-1.5 flex items-center justify-end gap-2">
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              {timestamp && (
                <span className="text-[11px] text-aether-muted tabular-nums">{timestamp}</span>
              )}
              <span className="text-sm font-semibold text-aether-text">{displayName}</span>
            </div>
          </div>
          <MessageAvatar isUser persona={avatarPersona} />
        </div>
      ) : (
        <div className="mb-1.5 flex items-center gap-2">
          <MessageAvatar isUser={false} persona={avatarPersona} />
          <div className="flex min-w-0 flex-1 items-center gap-2 justify-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-aether-text">{displayName}</span>
                {subtitle && subtitle !== displayName && (
                  <span className="text-xs text-aether-muted">{subtitle}</span>
                )}
                {timestamp && (
                  <span className="text-[11px] text-aether-muted tabular-nums">{timestamp}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={clsx(
          'min-w-0',
          isUser && 'flex flex-col items-end',
          getMessagePaddingClass(isUser ? 'user' : 'assistant', settings),
        )}
      >
        {(showBranchSwitcher || (!isStreaming && !showQueuedState)) && (
          <div className={clsx('mb-1 flex items-center gap-2', isUser && 'justify-end')}>
            {showBranchSwitcher && parentMessageId && (
              <BranchSwitcher parentMessageId={parentMessageId} disabled={isStreaming} />
            )}
            {!isStreaming && !showQueuedState && <MessageActions message={message} />}
          </div>
        )}

        {!isUser && hasThinkingTrace && (
          <ThinkingPanel
            blocks={message.thinking ?? []}
            toolCalls={message.toolCalls ?? []}
            citations={message.citations ?? []}
            isStreaming={isStreaming}
            hasResponseContent={Boolean(message.content)}
          />
        )}

        <div
          className={clsx(
            getMessageBubbleClass(isUser ? 'user' : 'assistant', settings),
            showQueuedState && 'border border-dashed border-amber-500/40 opacity-90',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : message.content ? (
            <MarkdownContent content={message.content} isStreaming={isStreaming} />
          ) : null}
        </div>

        {!isUser && <MessageAugmentations items={message.augmentations} />}

        {showQueuedState && (
          <p className={clsx('mt-1 text-[11px] text-amber-400/90', isUser && 'text-right')}>
            {queuedActionLabel ?? 'Queued — waiting to connect'}
          </p>
        )}

        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.citations.map((cite, i) => (
              <a
                key={i}
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-aether-muted hover:text-aether-text underline truncate max-w-[200px]"
              >
                {cite.title ?? new URL(cite.url).hostname}
              </a>
            ))}
          </div>
        )}


      </div>
    </div>
  );
}