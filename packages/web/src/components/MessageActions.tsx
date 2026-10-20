import { useState } from 'react';
import { Pencil, RefreshCw, Volume2, Square } from 'lucide-react';
import clsx from 'clsx';
import type { ChatMessage } from '@aether/shared';
import { useVoice } from '../context/voice-context';
import { useAppStore } from '../store/app-store';
import { RegenerateDialog } from './RegenerateDialog';
import { EditMessageDialog } from './EditMessageDialog';

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageActions({ message, isStreaming }: Props) {
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const {
    streamingConversationId,
    regenerateMessage,
    editMessage,
    activeConversationId,
    activeConversation,
  } = useAppStore();
  const chatStreaming = Boolean(
    streamingConversationId &&
    activeConversationId &&
    streamingConversationId === activeConversationId,
  );
  const settings = useAppStore((s) => s.settings);
  const { speakMessage, pauseTts, isSpeakingMessage } = useVoice();

  const disabled = chatStreaming || isStreaming;
  const ttsEnabled = settings?.voice.ttsEnabled ?? true;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {!isStreaming && message.role === 'assistant' && (
          <ActionButton
            icon={RefreshCw}
            label="Regenerate"
            onClick={() => setShowRegenerate(true)}
            disabled={disabled}
          />
        )}

        <ActionButton
          icon={Pencil}
          label="Edit"
          onClick={() => setShowEdit(true)}
          disabled={disabled}
        />

        {ttsEnabled && message.role === 'assistant' && message.content.trim() && (
          <ActionButton
            icon={isSpeakingMessage(message.id) ? Square : Volume2}
            label={isSpeakingMessage(message.id) ? 'Stop' : 'Read aloud'}
            onClick={() => (
              isSpeakingMessage(message.id)
                ? pauseTts()
                : speakMessage({
                    messageId: message.id,
                    content: message.content,
                    conversationId: activeConversationId ?? undefined,
                    conversationTitle: activeConversation?.title,
                  })
            )}
            disabled={disabled}
          />
        )}
      </div>

      {showRegenerate && (
        <RegenerateDialog
          storyMode={activeConversation?.settings.storyMode}
          castPersonaIds={activeConversation?.storyCastPersonaIds}
          onClose={() => setShowRegenerate(false)}
          onConfirm={async (opts) => {
            setShowRegenerate(false);
            await regenerateMessage(message.id, opts);
          }}
        />
      )}

      {showEdit && (
        <EditMessageDialog
          message={message}
          onClose={() => setShowEdit(false)}
          onConfirm={async (content) => {
            setShowEdit(false);
            await editMessage(message.id, content);
          }}
        />
      )}
    </>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
        disabled
          ? 'text-aether-muted/40 cursor-not-allowed'
          : 'text-aether-muted hover:text-aether-text hover:bg-aether-surface-2',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}