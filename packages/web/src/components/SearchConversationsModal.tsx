import { useEffect, useRef } from 'react';
import {
  Clock,
  MessageSquare,
  Search,
  Sparkles,
  Tag,
  Type,
  User,
  X,
} from 'lucide-react';
import type { ConversationSearchHit, SearchMatchField } from '@aether/shared';
import { formatMessageTime } from '@aether/shared';
import { api } from '../lib/api';
import { useAppStore } from '../store/app-store';
import { useSearchSessionStore } from '../store/search-session-store';

const FIELD_META: Record<
  SearchMatchField,
  { label: string; icon: typeof Search }
> = {
  title: { label: 'Title', icon: Type },
  content: { label: 'Message', icon: MessageSquare },
  model: { label: 'Model', icon: Sparkles },
  timestamp: { label: 'Time', icon: Clock },
  role: { label: 'Role', icon: User },
  conversation: { label: 'Chat', icon: Tag },
};

function HitRow({
  hit,
  onSelect,
}: {
  hit: ConversationSearchHit;
  onSelect: (hit: ConversationSearchHit) => void;
}) {
  const meta = FIELD_META[hit.matchField] ?? FIELD_META.content;
  const Icon = meta.icon;
  const timeLabel = hit.createdAt
    ? formatMessageTime(hit.createdAt)
    : hit.updatedAt
      ? formatMessageTime(hit.updatedAt)
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(hit)}
      className="w-full rounded-xl border border-aether-border bg-aether-bg/40 px-3 py-2.5 text-left transition-colors hover:bg-aether-bg/80 hover:border-aether-muted/40"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aether-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-aether-text truncate">
              {hit.conversationTitle}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-aether-muted bg-aether-surface-2 px-1.5 py-px rounded">
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-aether-muted leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {hit.snippet}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-aether-muted tabular-nums">
            {hit.role && <span>{hit.role === 'user' ? 'You' : 'Assistant'}</span>}
            {hit.model && <span>{hit.model}</span>}
            {timeLabel && <span>{timeLabel}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

export function SearchConversationsModal() {
  const open = useSearchSessionStore((s) => s.open);
  const query = useSearchSessionStore((s) => s.query);
  const hits = useSearchSessionStore((s) => s.hits);
  const loading = useSearchSessionStore((s) => s.loading);
  const error = useSearchSessionStore((s) => s.error);
  const truncated = useSearchSessionStore((s) => s.truncated);
  const scanned = useSearchSessionStore((s) => s.scannedConversations);
  const lastFetchedQuery = useSearchSessionStore((s) => s.lastFetchedQuery);
  const setOpen = useSearchSessionStore((s) => s.setOpen);
  const setQuery = useSearchSessionStore((s) => s.setQuery);
  const setLoading = useSearchSessionStore((s) => s.setLoading);
  const setError = useSearchSessionStore((s) => s.setError);
  const applyResult = useSearchSessionStore((s) => s.applyResult);
  const touch = useSearchSessionStore((s) => s.touch);
  const isSessionValid = useSearchSessionStore((s) => s.isSessionValid);
  const clearResults = useSearchSessionStore((s) => s.clearResults);

  const jumpTo = useAppStore((s) => s.jumpToConversationMessage);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    isSessionValid();
    touch();
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, isSessionValid, touch]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    // Warm session — same query already loaded
    if (q === lastFetchedQuery) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      void api
        .searchConversations(q)
        .then((res) => applyResult(res))
        .catch((err) =>
          setError(err instanceof Error ? err.message : 'Search failed'),
        );
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, lastFetchedQuery, setLoading, applyResult, setError]);

  if (!open) return null;

  const handleSelect = (hit: ConversationSearchHit) => {
    touch();
    void jumpTo(hit.conversationId, hit.messageId);
    setOpen(false);
    setSidebarOpen(false);
  };

  const handleClose = () => {
    touch();
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[min(12vh,5rem)]">
      <div className="absolute inset-0 bg-aether-overlay" onClick={handleClose} />
      <div className="relative flex w-full max-w-xl max-h-[min(80vh,640px)] flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex shrink-0 items-center gap-2 border-b border-aether-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-aether-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, messages, models, dates…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-aether-muted"
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClose();
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                clearResults();
                inputRef.current?.focus();
              }}
              className="text-[11px] text-aether-muted hover:text-aether-text"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!query.trim() && (
            <div className="px-2 py-8 text-center text-sm text-aether-muted">
              <p>Search across all conversations.</p>
              <p className="mt-2 text-xs leading-relaxed max-w-sm mx-auto">
                Matches titles, message text, model names, roles, and timestamps (e.g.{' '}
                <code className="text-[11px]">2026-07</code>,{' '}
                <code className="text-[11px]">yesterday</code>-style locale dates, or model ids).
              </p>
              {hits.length > 0 && lastFetchedQuery && (
                <p className="mt-4 text-xs text-aether-muted">
                  Session still has {hits.length} result{hits.length === 1 ? '' : 's'} from “
                  {lastFetchedQuery}”. Type to search again.
                </p>
              )}
            </div>
          )}

          {query.trim() && loading && (
            <p className="px-2 py-6 text-center text-sm text-aether-muted">Searching…</p>
          )}

          {query.trim() && error && (
            <p className="px-2 py-6 text-center text-sm text-red-300">{error}</p>
          )}

          {query.trim() && !loading && !error && hits.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-aether-muted">
              No matches in {scanned || 'your'} chat{scanned === 1 ? '' : 's'}.
            </p>
          )}

          {hits.length > 0 && (query.trim() || lastFetchedQuery) && (
            <div className="space-y-2">
              <p className="px-1 text-[11px] text-aether-muted">
                {hits.length} result{hits.length === 1 ? '' : 's'}
                {scanned > 0 ? ` · scanned ${scanned} chats` : ''}
                {truncated ? ' · showing top matches' : ''}
              </p>
              {hits.map((hit) => (
                <HitRow key={hit.id} hit={hit} onSelect={handleSelect} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-aether-border px-4 py-2 text-[10px] text-aether-muted">
          Results stay warm for 30 minutes after your last search interaction. Click a hit to open
          that chat
          {hits.some((h) => h.messageId) ? ' and jump to the message' : ''}.
        </div>
      </div>
    </div>
  );
}
