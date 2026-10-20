import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UseChatScrollOptions {
  /** Full list of messages (used to react to growth and identity changes). */
  messages: Array<{ id: string; role: string }>;
  /** The id of the most recent user-authored prompt (persisted or queued). */
  latestUserPromptId: string | null;
}

interface UseChatScrollResult {
  /** Attach to the scrollable viewport container (overflow-y-auto). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the inner content wrapper that receives the dynamic paddingBottom. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Bottom padding (px) applied when an anchor is active so non-terminal messages can sit at viewport top. */
  bottomPadding: number;
  /** True while we have an explicit anchor that matches the current latestUserPromptId. */
  isUserPromptAnchored: boolean;

  /**
   * Pin the given message (usually a user prompt) near the top of the viewport.
   * Responses appended below will not yank the view. User can still scroll away to release.
   */
  scrollToAnchor: (messageId: string, options?: { behavior?: ScrollBehavior }) => void;

  /**
   * One-off smooth (or auto) scroll that brings an arbitrary message into view.
   * Does NOT activate the persistent "anchor" pinning mode. Used by flowchart nav etc.
   * If currently anchored, this will release the anchor first.
   */
  scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior; block?: ScrollLogicalPosition }) => void;

  /** Immediately release any active anchor (padding cleared, no more auto-maintain). */
  releaseAnchor: () => void;
}

/**
 * useChatScroll – the single, lean controller for Aether's conversation scrolling UX.
 *
 * Design goals (kept ruthlessly simple):
 * - On send / commit of user prompt: its avatar head is placed near the top of the viewport.
 * - Assistant responses (streaming or final after markup) simply append below. No yank.
 * - User owns the scrollbar completely once they move the anchor out of view.
 * - Handles dynamic height changes (markdown, thinking panels, TTS bar, placeholders, avatars, branches).
 * - Zero legacy spacer divs, no distributed scrollTop math, no stickToBottom fighting the pin.
 *
 * Only two modes:
 *   1. Anchored (latest user prompt pinned) – used for the "prompt at top, grow below" experience.
 *   2. Free scroll – native browser behavior for reading history.
 */
export function useChatScroll({
  messages,
  latestUserPromptId,
}: UseChatScrollOptions): UseChatScrollResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [bottomPadding, setBottomPadding] = useState(0);

  const isUserPromptAnchored = anchorId != null && anchorId === latestUserPromptId;

  // Short-lived guard so our own programmatic scrolls don't trigger release logic.
  const programmaticScrollRef = useRef(false);

  const releaseAnchor = useCallback(() => {
    setAnchorId(null);
    setBottomPadding(0);
  }, []);

  // Locate the best element to align: prefer the avatar circle for user prompts.
  const findAlignElement = useCallback((id: string): HTMLElement | null => {
    const container = scrollRef.current;
    if (!container) return null;
    const msg = container.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null;
    if (!msg) return null;

    // Prefer the  h-10 w-10 avatar head (works for both user and assistant avatars).
    const avatar = msg.querySelector('div.h-10.w-10, div[class*="h-10 w-10"]') as HTMLElement | null;
    return avatar || msg;
  }, []);

  // Compute how much bottom padding is required so that the anchor can be scrolled to the very top of the viewport.
  const computeBottomPadding = useCallback((): number => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content || !anchorId) return 0;

    const alignEl = findAlignElement(anchorId);
    if (!alignEl) return 0;

    const containerH = container.clientHeight;
    // offsetTop is relative to the content's padding box.
    const anchorOffset = (alignEl as HTMLElement).offsetTop;

    // We want enough total scrollable height that scrollTop can reach anchorOffset.
    // Add a small buffer so the head isn't glued exactly to the chrome.
    const needed = anchorOffset + containerH - content.offsetHeight + 64;
    return Math.max(0, Math.ceil(needed));
  }, [anchorId, findAlignElement]);

  const updateBottomPadding = useCallback(() => {
    if (!anchorId) {
      if (bottomPadding !== 0) setBottomPadding(0);
      return;
    }
    const next = computeBottomPadding();
    if (next !== bottomPadding) setBottomPadding(next);
  }, [anchorId, bottomPadding, computeBottomPadding]);

  // Wait a few frames for dynamic content (images, md, panels) to settle before measuring/scrolling.
  const stabilizeAnd = useCallback((fn: () => void, maxFrames = 6) => {
    const container = scrollRef.current;
    let frames = 0;
    let lastH = -1;

    const tick = () => {
      frames += 1;
      const h = container ? container.scrollHeight : 0;
      if ((h === lastH && frames >= 2) || frames >= maxFrames) {
        fn();
        return;
      }
      lastH = h;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // Core: scroll an element so its top is near the top of the container.
  const performAnchorScroll = useCallback((id: string, behavior: ScrollBehavior = 'auto') => {
    const container = scrollRef.current;
    if (!container) return;

    const el = findAlignElement(id);
    if (!el) return;

    programmaticScrollRef.current = true;

    // Ensure padding is up to date for this anchor so scrollTo can reach the desired visual position.
    updateBottomPadding();

    // Primary alignment – block start puts the element at the top of the scrollport.
    el.scrollIntoView({ block: 'start', behavior });

    // Micro-correction on next frame(s) for pixel-perfect "head at top" after layout settles.
    requestAnimationFrame(() => {
      const el2 = findAlignElement(id);
      if (!el2 || !container) {
        programmaticScrollRef.current = false;
        return;
      }
      const cRect = container.getBoundingClientRect();
      const eRect = el2.getBoundingClientRect();
      const delta = eRect.top - cRect.top;
      // Leave a couple of px breathing room below the header area.
      if (Math.abs(delta) > 3) {
        container.scrollTop = Math.max(0, container.scrollTop + delta - 6);
      }
      // Release the guard after another frame.
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, [findAlignElement, updateBottomPadding]);

  const scrollToAnchor = useCallback(
    (messageId: string, options: { behavior?: ScrollBehavior } = {}) => {
      setAnchorId(messageId);
      // Defer so the element (and any just-appended optimistic message) is in the DOM.
      requestAnimationFrame(() => {
        const doIt = () => {
          performAnchorScroll(messageId, options.behavior ?? 'auto');
          // Recompute padding after the scroll may have triggered layout.
          requestAnimationFrame(updateBottomPadding);
        };

        // 'auto' (used for convo loads and sends) should be immediate.
        // Only use the stabilize loop for explicit smooth cases to let
        // dynamic content settle before animating.
        if (options.behavior === 'auto') {
          doIt();
        } else {
          stabilizeAnd(doIt);
        }
      });
    },
    [performAnchorScroll, stabilizeAnd, updateBottomPadding]
  );

  const scrollToMessage = useCallback(
    (messageId: string, options: { behavior?: ScrollBehavior; block?: ScrollLogicalPosition } = {}) => {
      const container = scrollRef.current;
      if (!container) return;

      // Jumps from history (flowchart) should exit pin mode.
      if (anchorId) {
        releaseAnchor();
      }

      const el = findAlignElement(messageId);
      if (!el) return;

      programmaticScrollRef.current = true;

      el.scrollIntoView({
        block: options.block ?? 'center',
        behavior: options.behavior ?? 'smooth',
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    },
    [anchorId, releaseAnchor, findAlignElement]
  );

  // When content grows (streaming tokens, final commit, thinking expand, TTS bar, etc.)
  // while we are anchored to the user prompt, gently keep the anchor head visually stable.
  useLayoutEffect(() => {
    if (!anchorId || !isUserPromptAnchored) return;

    const container = scrollRef.current;
    if (!container) return;

    const el = findAlignElement(anchorId);
    if (!el) return;

    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const offset = eRect.top - cRect.top;

    // Small drift tolerance. Correct instantly (no animation) to avoid visible jump.
    if (offset > 10 || offset < -4) {
      const target = container.scrollTop + offset - 6;
      container.scrollTop = Math.max(0, target);
    }
  }, [messages.length, anchorId, isUserPromptAnchored, findAlignElement]);

  // Keep padding correct when anchor or content size changes.
  useEffect(() => {
    if (!anchorId) {
      setBottomPadding(0);
      return;
    }
    const raf = requestAnimationFrame(updateBottomPadding);
    return () => cancelAnimationFrame(raf);
  }, [anchorId, messages.length, latestUserPromptId, updateBottomPadding]);

  // ResizeObserver on the content box catches async height changes (final markdown parse, images, panels).
  useEffect(() => {
    const content = contentRef.current;
    const container = scrollRef.current;
    if (!content || !container) return;

    const ro = new ResizeObserver(() => {
      if (anchorId && isUserPromptAnchored) {
        updateBottomPadding();

        // After a resize that affected layout, re-nudge the anchor head if it drifted.
        requestAnimationFrame(() => {
          const el = findAlignElement(anchorId);
          if (el && container) {
            const cRect = container.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();
            const delta = eRect.top - cRect.top;
            if (delta > 8) {
              container.scrollTop += delta - 6;
            }
          }
        });
      }
    });

    ro.observe(content);
    return () => ro.disconnect();
  }, [anchorId, isUserPromptAnchored, updateBottomPadding, findAlignElement]);

  // User scroll listener: if they scroll the anchored prompt significantly above the viewport, release.
  // This gives the user full control and prevents the system fighting them.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (!anchorId) return;

      const el = findAlignElement(anchorId);
      if (!el) return;

      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const visualTop = eRect.top - cRect.top;

      // Threshold: once the prompt head is 100px or more above the top edge, user has taken over.
      if (visualTop < -100) {
        releaseAnchor();
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [anchorId, releaseAnchor, findAlignElement]);

  return {
    scrollRef,
    contentRef,
    bottomPadding,
    isUserPromptAnchored,
    scrollToAnchor,
    scrollToMessage,
    releaseAnchor,
  };
}
