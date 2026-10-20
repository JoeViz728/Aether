import type { StreamingState } from './stream-events';

const IMMEDIATE_FLUSH_EVENTS = new Set([
  'tool_call_start',
  'tool_call_end',
  'thinking_start',
  'thinking_end',
  'model_selected',
  'responder_selected',
  'error',
  'done',
]);

export function shouldFlushStreamUiImmediately(eventType: string): boolean {
  return IMMEDIATE_FLUSH_EVENTS.has(eventType);
}

export interface StreamUiBatcher {
  schedule: (state: StreamingState) => void;
  flushNow: (state: StreamingState) => void;
  dispose: () => void;
}

export function createStreamUiBatcher(onFlush: (state: StreamingState) => void): StreamUiBatcher {
  let pending: StreamingState | null = null;
  let rafId: number | null = null;

  const flush = () => {
    rafId = null;
    if (!pending) return;
    const state = pending;
    pending = null;
    onFlush(state);
  };

  return {
    schedule: (state) => {
      pending = state;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(flush);
    },

    flushNow: (state) => {
      pending = state;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flush();
    },

    dispose: () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (pending) flush();
    },
  };
}