import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  direction: 'earlier' | 'later';
  count: number;
  onLoad: () => void;
  /** Only for later edge — jump straight to the live tail. */
  onJumpLatest?: () => void;
}

export function MessageWindowChrome({ direction, count, onLoad, onJumpLatest }: Props) {
  const isEarlier = direction === 'earlier';

  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onLoad}
          className="inline-flex items-center gap-1.5 rounded-full border border-aether-border bg-aether-surface px-3 py-1.5 text-xs text-aether-muted hover:text-aether-text hover:bg-aether-surface-2 transition-colors"
        >
          {isEarlier ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {isEarlier
            ? `Load earlier (${count.toLocaleString()})`
            : `Load later (${count.toLocaleString()})`}
        </button>
        {!isEarlier && onJumpLatest && (
          <button
            type="button"
            onClick={onJumpLatest}
            className="inline-flex items-center gap-1.5 rounded-full border border-aether-border bg-aether-surface px-3 py-1.5 text-xs text-aether-muted hover:text-aether-text hover:bg-aether-surface-2 transition-colors"
          >
            Jump to latest
          </button>
        )}
      </div>
      <p className="text-[10px] text-aether-muted/80">
        {isEarlier
          ? 'Or scroll up to reveal more history'
          : 'Or scroll down to continue the thread'}
      </p>
    </div>
  );
}
