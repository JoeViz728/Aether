import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '../store/app-store';
import { listBranchVariants } from '../lib/branches';

interface Props {
  parentMessageId: string;
  disabled?: boolean;
}

export function BranchSwitcher({ parentMessageId, disabled }: Props) {
  const { activeConversation, activeConversationId, switchBranch, streamingConversationId } = useAppStore();
  const isStreaming = Boolean(
    streamingConversationId &&
    activeConversationId &&
    streamingConversationId === activeConversationId,
  );

  if (!activeConversation) return null;

  const variants = listBranchVariants(activeConversation, parentMessageId);
  if (variants.length < 2) return null;

  const activeIndex = Math.max(0, variants.findIndex((v) => v.isActive));
  const active = variants[activeIndex];

  const go = (delta: number) => {
    const next = variants[activeIndex + delta];
    if (!next || disabled || isStreaming) return;
    switchBranch(parentMessageId, next.id);
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-aether-border bg-aether-surface/80 px-1 py-0.5">
      <GitBranch className="h-3.5 w-3.5 text-aether-muted ml-1" />
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={disabled || isStreaming || activeIndex <= 0}
        className="rounded p-1 text-aether-muted hover:text-aether-text disabled:opacity-30"
        title="Previous variant"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className={clsx('px-1 text-xs font-medium min-w-[4.5rem] text-center', 'text-aether-text')}>
        {activeIndex + 1} / {variants.length}
      </span>
      <span className="text-xs text-aether-muted max-w-[8rem] truncate hidden sm:inline" title={active?.label}>
        {active?.label}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        disabled={disabled || isStreaming || activeIndex >= variants.length - 1}
        className="rounded p-1 text-aether-muted hover:text-aether-text disabled:opacity-30"
        title="Next variant"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}