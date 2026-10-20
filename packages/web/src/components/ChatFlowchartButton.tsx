import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import clsx from 'clsx';
import type { Conversation } from '@aether/shared';
import { ChatFlowchartModal } from './ChatFlowchartModal';

interface Props {
  conversation: Conversation | null;
  disabled?: boolean;
  onNavigateToMessage: (messageId: string) => void;
}

export function ChatFlowchartButton({ conversation, disabled, onNavigateToMessage }: Props) {
  const [open, setOpen] = useState(false);
  const hasItems = Boolean(conversation && conversation.messages.length > 0);

  // Hide entirely on empty / new chats — no disabled ghost button.
  if (!hasItems) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Conversation flow"
        aria-label="Conversation flow"
        className={clsx(
          'rounded-lg p-2 text-aether-muted transition-colors hover:bg-aether-surface-2 hover:text-aether-text',
          open && 'bg-aether-surface-2 text-aether-text',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <GitBranch className="h-5 w-5" />
      </button>

      {open && conversation && (
        <ChatFlowchartModal
          conversation={conversation}
          onClose={() => setOpen(false)}
          onNavigateToMessage={onNavigateToMessage}
        />
      )}
    </>
  );
}
