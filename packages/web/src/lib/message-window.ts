/** How many messages to show when opening a chat or jumping to a point. */
export const MESSAGE_WINDOW_INITIAL = 48;
/** How many messages to add when the user scrolls toward an edge or taps Load. */
export const MESSAGE_WINDOW_EXPAND = 32;
/**
 * Soft cap on mounted bubbles. Expanding one edge may drop the other so we
 * never mount thousands of MessageBubbles for imported mega-threads.
 */
export const MESSAGE_WINDOW_MAX = 96;
/** px from top/bottom of the scroller that triggers automatic expansion. */
export const MESSAGE_WINDOW_EDGE_PX = 280;

export interface MessageWindowRange {
  /** Inclusive start index into the full messages array. */
  start: number;
  /** Exclusive end index. */
  end: number;
  total: number;
  hasEarlier: boolean;
  hasLater: boolean;
  earlierCount: number;
  laterCount: number;
}

export function emptyMessageWindow(): MessageWindowRange {
  return {
    start: 0,
    end: 0,
    total: 0,
    hasEarlier: false,
    hasLater: false,
    earlierCount: 0,
    laterCount: 0,
  };
}

export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, index));
}

export function rangeFromBounds(
  start: number,
  end: number,
  total: number,
): MessageWindowRange {
  if (total <= 0) return emptyMessageWindow();
  const s = Math.max(0, Math.min(start, total));
  const e = Math.max(s, Math.min(end, total));
  return {
    start: s,
    end: e,
    total,
    hasEarlier: s > 0,
    hasLater: e < total,
    earlierCount: s,
    laterCount: total - e,
  };
}

/** Tail window: last `size` messages (or all if shorter). */
export function tailWindow(
  total: number,
  size = MESSAGE_WINDOW_INITIAL,
): MessageWindowRange {
  if (total <= 0) return emptyMessageWindow();
  const start = Math.max(0, total - size);
  return rangeFromBounds(start, total, total);
}

/** Window centered on `centerIndex` (inclusive focus). */
export function windowAround(
  total: number,
  centerIndex: number,
  size = MESSAGE_WINDOW_INITIAL,
): MessageWindowRange {
  if (total <= 0) return emptyMessageWindow();
  const center = clampIndex(centerIndex, total);
  const half = Math.floor(size / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(total, start + size);
  start = Math.max(0, end - size);
  return rangeFromBounds(start, end, total);
}

export function expandEarlier(
  range: MessageWindowRange,
  by = MESSAGE_WINDOW_EXPAND,
  maxMounted = MESSAGE_WINDOW_MAX,
): MessageWindowRange {
  if (range.total <= 0 || !range.hasEarlier) return range;
  let start = Math.max(0, range.start - by);
  let end = range.end;
  if (end - start > maxMounted) {
    end = start + maxMounted;
  }
  return rangeFromBounds(start, end, range.total);
}

export function expandLater(
  range: MessageWindowRange,
  by = MESSAGE_WINDOW_EXPAND,
  maxMounted = MESSAGE_WINDOW_MAX,
): MessageWindowRange {
  if (range.total <= 0 || !range.hasLater) return range;
  let end = Math.min(range.total, range.end + by);
  let start = range.start;
  if (end - start > maxMounted) {
    start = end - maxMounted;
  }
  return rangeFromBounds(start, end, range.total);
}

/**
 * Keep the window glued to the live tail when new messages append, if we were
 * already showing the end of the log.
 */
export function followTailIfNeeded(
  prev: MessageWindowRange,
  total: number,
  size = MESSAGE_WINDOW_INITIAL,
): MessageWindowRange {
  if (total <= 0) return emptyMessageWindow();
  // First paint / empty → tail
  if (prev.total === 0) return tailWindow(total, size);
  // Still at end (or was) → stay on tail
  if (prev.end >= prev.total) {
    return tailWindow(total, Math.max(size, prev.end - prev.start));
  }
  // Mid-history: keep absolute indices if possible; clamp if list shrank
  if (total === prev.total) return prev;
  if (total < prev.total) {
    return rangeFromBounds(
      Math.min(prev.start, total),
      Math.min(prev.end, total),
      total,
    );
  }
  // List grew but we were not at end — keep window in place
  return rangeFromBounds(prev.start, prev.end, total);
}

export function findMessageIndexById(
  messages: Array<{ id: string }>,
  messageId: string,
): number {
  return messages.findIndex((m) => m.id === messageId);
}
