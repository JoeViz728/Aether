import { Loader2, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import type { ToolCallRecord } from '@aether/shared';
import { getMessagePaddingClass } from '../lib/chat-layout';
import { useAppStore } from '../store/app-store';
import { ToolCallBadge } from './ToolCallBadge';

interface Props {
  label?: string;
  detail?: string;
  toolCalls?: ToolCallRecord[];
}

export function GeneratingResponsePlaceholder({ label, detail, toolCalls }: Props) {
  const settings = useAppStore((s) => s.settings);
  const paddingClass = getMessagePaddingClass('assistant', settings);

  return (
    <div className="w-full animate-fade-in" data-message-id="generating-placeholder">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-aether-accent text-aether-bg">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-semibold text-aether-text">Aether</span>
          <span className="flex items-center gap-1.5 text-[11px] text-aether-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working…
          </span>
        </div>
      </div>

      <div className={clsx('min-w-0', paddingClass)}>
        {toolCalls && toolCalls.length > 0 && <ToolCallBadge toolCalls={toolCalls} />}

        <div
          className={clsx(
            'rounded-2xl border border-dashed border-aether-border/80 bg-aether-surface/40 px-4 py-3.5',
          )}
        >
          <p className="text-sm text-aether-text">{label ?? 'Generating response…'}</p>
          {detail && (
            <p className="mt-1 text-xs text-aether-muted leading-relaxed">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}