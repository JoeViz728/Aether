import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Play,
  Square,
  RefreshCw,
  Volume2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useVoice } from '../context/voice-context';
import { useAppStore } from '../store/app-store';
import { getChatWidthClass } from '../lib/chat-layout';

export function TtsPlaybackBar() {
  const settings = useAppStore((s) => s.settings);
  const {
    playback,
    pauseTts,
    playTts,
    nextParagraph,
    previousParagraph,
    regenerateTts,
    dismissTts,
  } = useVoice();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatWidthClass = getChatWidthClass(settings?.chatWidth);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  if (!playback) return null;

  const canGoBack = playback.currentParagraph > 1;
  const canGoForward = playback.currentParagraph < playback.totalParagraphs;

  return (
    <div className={clsx('mx-auto w-full mb-3 animate-fade-in', chatWidthClass)}>
      <div className="flex items-center gap-2 rounded-xl border border-aether-border bg-aether-surface px-3 py-2.5 shadow-sm">
        <button
          type="button"
          onClick={() => void previousParagraph()}
          disabled={!canGoBack}
          className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text disabled:opacity-30 transition-colors"
          title="Previous paragraph"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <Volume2
            className="h-4 w-4 shrink-0 text-aether-muted"
            aria-label="Reading aloud"
          />
          {playback.isPreparing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-aether-muted" />
          ) : playback.isPlaying ? (
            <span
              className="relative flex h-4 w-4 shrink-0 items-center justify-center"
              aria-label="Playback in progress"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-aether-muted/30" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-aether-text" />
            </span>
          ) : null}
          <p className="truncate text-sm font-medium text-aether-text">
            Paragraph {playback.currentParagraph} of {playback.totalParagraphs}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void nextParagraph()}
          disabled={!canGoForward}
          className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text disabled:opacity-30 transition-colors"
          title="Next paragraph"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {playback.isPlaying || playback.isPreparing ? (
          <button
            type="button"
            onClick={pauseTts}
            className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
            title="Stop playback"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void playTts()}
            className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
            title="Play current paragraph"
          >
            <Play className="h-4 w-4" />
          </button>
        )}

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
            title="More options"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[11rem] rounded-lg border border-aether-border bg-aether-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  await regenerateTts();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-aether-text hover:bg-aether-surface-2 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate audio
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismissTts}
          className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}