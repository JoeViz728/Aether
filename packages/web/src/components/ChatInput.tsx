import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Send, Mic, Square, Loader2, MoreVertical, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useVoice } from '../context/voice-context';
import { useAppStore } from '../store/app-store';
import {
  CHAT_INPUT_COMPOSE_UNSTACK_WIDTH,
  CHAT_INPUT_MIN_TEXTAREA_WIDTH,
  getChatWidthClass,
} from '../lib/chat-layout';
import { SendToInline } from './SendToInline';

interface Props {
  onSend: (message: string) => void;
  onInsertResponse?: () => void;
  showInsertResponse?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoDictate?: boolean;
}

export function ChatInput({
  onSend,
  onInsertResponse,
  showInsertResponse,
  disabled,
  placeholder,
  autoDictate,
}: Props) {
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [composeStacked, setComposeStacked] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const autoDictateStarted = useRef(false);
  const { isRecording, isTranscribing, sttAvailable, startDictation, stopDictation } = useVoice();
  const settings = useAppStore((s) => s.settings);
  const personas = useAppStore((s) => s.personas);
  const sendTargetValue = useAppStore((s) => s.sendTargetValue);
  const setSendTarget = useAppStore((s) => s.setSendTarget);
  const storyMode = useAppStore((s) => Boolean(s.activeConversation?.settings.storyMode));

  const sttEnabled = settings?.voice.sttEnabled ?? true;
  const chatWidthClass = getChatWidthClass(settings?.chatWidth);
  const hasText = Boolean(value.trim());

  useEffect(() => {
    const compose = composeRef.current;
    if (!compose) return;

    const updateComposeLayout = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      setComposeStacked((stacked) => {
        const composeWidth = compose.clientWidth;
        const textareaWidth = textarea.getBoundingClientRect().width;

        if (stacked) {
          return composeWidth < CHAT_INPUT_COMPOSE_UNSTACK_WIDTH;
        }
        return textareaWidth < CHAT_INPUT_MIN_TEXTAREA_WIDTH;
      });
    };

    const observer = new ResizeObserver(updateComposeLayout);
    observer.observe(compose);
    updateComposeLayout();

    return () => observer.disconnect();
  }, [sendTargetValue, hasText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (!autoDictate || autoDictateStarted.current || disabled || !sttEnabled || !sttAvailable) {
      return;
    }

    autoDictateStarted.current = true;
    startDictation().catch(() => {
      autoDictateStarted.current = false;
    });
  }, [autoDictate, disabled, sttEnabled, sttAvailable, startDictation]);

  useEffect(() => {
    if (hasText && menuOpen) setMenuOpen(false);
  }, [hasText, menuOpen]);

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

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleRecording = async () => {
    if (!sttEnabled || !sttAvailable) return;

    if (isRecording) {
      const text = await stopDictation();
      if (text) setValue((v) => (v ? `${v} ${text}` : text));
    } else {
      await startDictation();
    }
  };

  return (
    <div className={clsx('relative mx-auto w-full', chatWidthClass)}>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-aether-border bg-aether-surface px-3 py-2.5 shadow-lg">
          <div
            ref={composeRef}
            className={clsx(
              'flex min-w-0 flex-1',
              composeStacked
                ? 'flex-col items-stretch gap-1.5'
                : 'flex-row items-center gap-0',
            )}
          >
            <SendToInline
              value={sendTargetValue}
              onChange={(target) => void setSendTarget(target)}
              personas={personas}
              showPersonas={!storyMode}
              disabled={disabled}
              stacked={composeStacked}
            />

            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? 'Ask anything…'}
              disabled={disabled || isTranscribing}
              rows={1}
              className={clsx(
                'min-w-0 resize-none bg-transparent py-1.5 text-aether-text placeholder:text-aether-muted outline-none text-base leading-6 max-h-[200px]',
                composeStacked ? 'w-full flex-none' : 'flex-1',
              )}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {sttEnabled && (
              <button
                type="button"
                onClick={toggleRecording}
                disabled={disabled || isTranscribing || !sttAvailable}
                className={clsx(
                  'rounded-lg p-2 transition-colors',
                  isRecording
                    ? 'bg-red-500/20 text-red-400'
                    : isTranscribing
                      ? 'text-aether-muted cursor-wait'
                      : sttAvailable
                        ? 'text-aether-muted hover:text-aether-text hover:bg-aether-surface-2'
                        : 'text-aether-muted/40 cursor-not-allowed',
                )}
                title={
                  !sttAvailable
                    ? 'Microphone not available'
                    : isRecording
                      ? 'Stop dictation'
                      : 'Start dictation'
                }
              >
                {isTranscribing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isRecording ? (
                  <Square className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
            )}

            {hasText && (
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || isTranscribing}
                className={clsx(
                  'rounded-lg p-2 transition-colors animate-fade-in',
                  !disabled && !isTranscribing
                    ? 'bg-aether-accent text-aether-bg hover:opacity-90'
                    : 'text-aether-muted cursor-not-allowed',
                )}
                title="Send message"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {showInsertResponse && onInsertResponse && !hasText && (
          <div className="relative shrink-0 self-center" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={disabled}
              className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text disabled:opacity-40 transition-colors"
              aria-label="Chat options"
            >
              <MoreVertical className="h-5 w-5" />
            </button>

            {menuOpen && (
              <div className="absolute bottom-full right-0 z-50 mb-2 min-w-[12rem] rounded-lg border border-aether-border bg-aether-surface py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onInsertResponse();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-aether-text hover:bg-aether-surface-2 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate response
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isRecording && (
        <p className="mt-2 text-center text-xs text-red-400 animate-pulse">
          Listening… tap stop when done
        </p>
      )}
      {isTranscribing && (
        <p className="mt-2 text-center text-xs text-aether-muted">
          Transcribing…
        </p>
      )}
    </div>
  );
}