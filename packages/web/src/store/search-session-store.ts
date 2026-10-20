import { create } from 'zustand';
import type { ConversationSearchHit, ConversationSearchResponse } from '@aether/shared';

/** Keep last query/results warm after the modal closes. */
const SESSION_TTL_MS = 30 * 60 * 1000;

interface SearchSessionState {
  open: boolean;
  query: string;
  hits: ConversationSearchHit[];
  scannedConversations: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  /** Epoch ms — sliding expiry on each interaction */
  expiresAt: number | null;
  lastFetchedQuery: string | null;

  setOpen: (open: boolean) => void;
  touch: () => void;
  isSessionValid: () => boolean;
  setQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  applyResult: (result: ConversationSearchResponse) => void;
  clearResults: () => void;
}

function freshExpiry(): number {
  return Date.now() + SESSION_TTL_MS;
}

export const useSearchSessionStore = create<SearchSessionState>((set, get) => ({
  open: false,
  query: '',
  hits: [],
  scannedConversations: 0,
  truncated: false,
  loading: false,
  error: null,
  expiresAt: null,
  lastFetchedQuery: null,

  setOpen: (open) => {
    if (open) {
      set({ open: true, expiresAt: freshExpiry() });
    } else {
      set({ open: false, expiresAt: get().expiresAt ? freshExpiry() : null });
    }
  },

  touch: () => {
    if (get().expiresAt != null || get().hits.length > 0 || get().query) {
      set({ expiresAt: freshExpiry() });
    }
  },

  isSessionValid: () => {
    const { expiresAt } = get();
    if (expiresAt == null) return false;
    if (Date.now() > expiresAt) {
      set({
        hits: [],
        query: '',
        lastFetchedQuery: null,
        scannedConversations: 0,
        truncated: false,
        error: null,
        expiresAt: null,
      });
      return false;
    }
    return true;
  },

  setQuery: (query) => set({ query, expiresAt: freshExpiry() }),

  setLoading: (loading) => set({ loading, expiresAt: freshExpiry() }),

  setError: (error) => set({ error, loading: false, expiresAt: freshExpiry() }),

  applyResult: (result) =>
    set({
      hits: result.hits,
      scannedConversations: result.scannedConversations,
      truncated: result.truncated,
      lastFetchedQuery: result.query,
      loading: false,
      error: null,
      expiresAt: freshExpiry(),
    }),

  clearResults: () =>
    set({
      hits: [],
      lastFetchedQuery: null,
      scannedConversations: 0,
      truncated: false,
      error: null,
      query: '',
      expiresAt: null,
    }),
}));
