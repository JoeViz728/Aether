import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  MESSAGE_WINDOW_EDGE_PX,
  MESSAGE_WINDOW_EXPAND,
  MESSAGE_WINDOW_INITIAL,
  MESSAGE_WINDOW_MAX,
  expandEarlier,
  expandLater,
  followTailIfNeeded,
  findMessageIndexById,
  tailWindow,
  windowAround,
  type MessageWindowRange,
  emptyMessageWindow,
} from '../lib/message-window';

interface UseMessageWindowOptions {
  /** Conversation identity — resets the window when this changes. */
  conversationKey: string | null;
  messages: Array<{ id: string }>;
  /** Scroll viewport (same element as useChatScroll.scrollRef). */
  scrollRef: React.RefObject<HTMLElement | null>;
}

interface UseMessageWindowResult {
  range: MessageWindowRange;
  /** Slice of `messages` currently mounted. */
  visibleMessages: Array<{ id: string }>;
  /** Inclusive start index of the first visible message. */
  startIndex: number;
  ensureMessageVisible: (messageId: string) => boolean;
  loadEarlier: () => void;
  loadLater: () => void;
  jumpToLatest: () => void;
}

/**
 * Sliding message window for long threads.
 * Mounts at most ~MESSAGE_WINDOW_MAX bubbles; expands when the user scrolls
 * toward an edge, taps Load earlier/later, or jumps via flowchart.
 */
export function useMessageWindow({
  conversationKey,
  messages,
  scrollRef,
}: UseMessageWindowOptions): UseMessageWindowResult {
  const total = messages.length;
  const [range, setRange] = useState<MessageWindowRange>(() =>
    tailWindow(total, MESSAGE_WINDOW_INITIAL),
  );

  const prevKeyRef = useRef<string | null>(null);
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);
  const expandingRef = useRef(false);

  // Reset to tail on conversation switch.
  useEffect(() => {
    if (conversationKey === prevKeyRef.current) return;
    prevKeyRef.current = conversationKey;
    setRange(tailWindow(messages.length, MESSAGE_WINDOW_INITIAL));
  }, [conversationKey, messages.length]);

  // Follow live growth when pinned to the end; clamp if list shrinks.
  useEffect(() => {
    setRange((prev) => followTailIfNeeded(prev, total, MESSAGE_WINDOW_INITIAL));
  }, [total]);

  // After expanding upward, keep the same visual content under the viewport.
  useLayoutEffect(() => {
    const pending = preserveScrollRef.current;
    const el = scrollRef.current;
    if (!pending || !el) return;
    const delta = el.scrollHeight - pending.height;
    if (delta !== 0) {
      el.scrollTop = pending.top + delta;
    }
    preserveScrollRef.current = null;
    expandingRef.current = false;
  }, [range.start, range.end, scrollRef]);

  const loadEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      preserveScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    expandingRef.current = true;
    setRange((prev) => expandEarlier(prev, MESSAGE_WINDOW_EXPAND, MESSAGE_WINDOW_MAX));
  }, [scrollRef]);

  const loadLater = useCallback(() => {
    expandingRef.current = true;
    setRange((prev) => expandLater(prev, MESSAGE_WINDOW_EXPAND, MESSAGE_WINDOW_MAX));
  }, []);

  const jumpToLatest = useCallback(() => {
    setRange(tailWindow(total, MESSAGE_WINDOW_INITIAL));
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
  }, [total, scrollRef]);

  const ensureMessageVisible = useCallback(
    (messageId: string): boolean => {
      const index = findMessageIndexById(messages, messageId);
      if (index < 0) return false;
      setRange((prev) => {
        if (index >= prev.start && index < prev.end) return prev;
        return windowAround(messages.length, index, MESSAGE_WINDOW_INITIAL);
      });
      return true;
    },
    [messages],
  );

  // Edge detection: near top → earlier; near bottom → later (when history exists).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (expandingRef.current || preserveScrollRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = el;
      const distBottom = scrollHeight - scrollTop - clientHeight;

      if (scrollTop < MESSAGE_WINDOW_EDGE_PX) {
        setRange((prev) => {
          if (!prev.hasEarlier) return prev;
          preserveScrollRef.current = { height: scrollHeight, top: scrollTop };
          expandingRef.current = true;
          return expandEarlier(prev, MESSAGE_WINDOW_EXPAND, MESSAGE_WINDOW_MAX);
        });
        return;
      }

      if (distBottom < MESSAGE_WINDOW_EDGE_PX) {
        setRange((prev) => {
          if (!prev.hasLater) return prev;
          expandingRef.current = true;
          return expandLater(prev, MESSAGE_WINDOW_EXPAND, MESSAGE_WINDOW_MAX);
        });
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, range.hasEarlier, range.hasLater]);

  const start = range.total === 0 ? 0 : range.start;
  const end = range.total === 0 ? 0 : range.end;
  const visibleMessages = messages.slice(start, end);

  return {
    range: total === 0 ? emptyMessageWindow() : range,
    visibleMessages,
    startIndex: start,
    ensureMessageVisible,
    loadEarlier,
    loadLater,
    jumpToLatest,
  };
}
