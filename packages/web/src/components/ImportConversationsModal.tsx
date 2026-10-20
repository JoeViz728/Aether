import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import type { ConversationImportPreview } from '@aether/shared';
import { api } from '../lib/api';

interface Props {
  file: File;
  onClose: () => void;
  onImported: (count: number) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ImportConversationsModal({ file, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ConversationImportPreview[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source, setSource] = useState<string>('xai');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  /** Active preview session; cleared after commit so we do not cancel a finished import. */
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    sessionRef.current = null;

    void api
      .previewConversationImport(file)
      .then((preview) => {
        if (cancelled) {
          void api.cancelConversationImport(preview.sessionId);
          return;
        }
        sessionRef.current = preview.sessionId;
        setSessionId(preview.sessionId);
        setItems(preview.conversations);
        setSkipped(preview.skipped);
        setWarnings(preview.warnings ?? []);
        setSource(preview.source);
        // Default: nothing selected — user chooses deliberately
        setSelected(new Set());
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to parse export');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void api.cancelConversationImport(id);
    };
  }, [file]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = `${item.title}\n${item.preview}\n${item.model ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const selectedVisibleCount = filtered.filter((i) => selected.has(i.id)).length;
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const item of filtered) next.delete(item.id);
      } else {
        for (const item of filtered) next.add(item.id);
      }
      return next;
    });
  };

  const selectNone = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));

  const handleImport = async () => {
    if (!sessionId || selected.size === 0 || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const report = await api.commitConversationImport(sessionId, [...selected]);
      // Session is consumed server-side; clear ref so unmount does not cancel
      sessionRef.current = null;
      setSessionId(null);
      onImported(report.imported);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setCommitting(false);
    }
  };

  const handleClose = () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id) void api.cancelConversationImport(id);
    setSessionId(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={handleClose} />
      <div className="relative flex h-[min(90vh,720px)] w-full max-w-2xl flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex shrink-0 items-center justify-between border-b border-aether-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Import conversations</h2>
            <p className="mt-0.5 text-xs text-aether-muted truncate">
              {file.name}
              {!loading && items.length > 0 && (
                <>
                  {' '}
                  · {items.length} found
                  {skipped > 0 ? ` · ${skipped} empty skipped` : ''}
                  {source ? ` · ${source}` : ''}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
            aria-label="Close import"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-aether-muted">
            <Upload className="h-8 w-8 animate-pulse opacity-50" />
            <p>Parsing export…</p>
            <p className="text-xs">Large zips can take a moment. Nothing is saved yet.</p>
          </div>
        ) : error && items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-aether-border px-4 py-2 text-sm hover:bg-aether-surface-2"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-3 border-b border-aether-border px-6 py-3">
              <p className="text-xs text-aether-muted leading-relaxed">
                Review chats below, expand a row to skim the transcript, then mark the ones to
                import. Nothing is written until you confirm.
              </p>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-aether-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by title or preview…"
                  className="w-full rounded-lg border border-aether-border bg-aether-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-aether-muted"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={toggleVisible}
                  className="rounded-md border border-aether-border px-2.5 py-1 hover:bg-aether-surface-2"
                >
                  {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-md border border-aether-border px-2.5 py-1 hover:bg-aether-surface-2"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={selectNone}
                  className="rounded-md border border-aether-border px-2.5 py-1 hover:bg-aether-surface-2"
                >
                  Select none
                </button>
                <span className="ml-auto text-aether-muted tabular-nums">
                  {selected.size} selected
                  {query.trim() ? ` · ${selectedVisibleCount} in filter` : ''}
                </span>
              </div>

              {warnings.length > 0 && (
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  {warnings.slice(0, 3).join(' ')}
                </p>
              )}
              {error && <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>}
            </div>

            <ul className="flex-1 overflow-y-auto px-3 py-2">
              {filtered.length === 0 ? (
                <li className="px-3 py-10 text-center text-sm text-aether-muted">
                  No conversations match this filter.
                </li>
              ) : (
                filtered.map((item) => {
                  const isSelected = selected.has(item.id);
                  const isExpanded = expandedId === item.id;
                  return (
                    <li
                      key={item.id}
                      className={clsx(
                        'mb-1.5 rounded-xl border transition-colors',
                        isSelected
                          ? 'border-aether-tool-active/40 bg-aether-tool/20'
                          : 'border-aether-border bg-aether-bg/30 hover:bg-aether-bg/60',
                      )}
                    >
                      <div className="flex items-start gap-2 p-3">
                        <input
                          type="checkbox"
                          className="mt-1 rounded"
                          checked={isSelected}
                          onChange={() => toggleOne(item.id)}
                          aria-label={`Select ${item.title}`}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() =>
                            setExpandedId((id) => (id === item.id ? null : item.id))
                          }
                        >
                          <div className="flex items-start gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aether-muted" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aether-muted" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium leading-snug">{item.title}</div>
                              <div className="mt-0.5 text-[11px] text-aether-muted tabular-nums">
                                {item.messageCount} messages
                                {' · '}
                                {item.userMessageCount} you / {item.assistantMessageCount} assistant
                                {item.model ? ` · ${item.model}` : ''}
                                {' · '}
                                {formatDate(item.updatedAt)}
                              </div>
                              {!isExpanded && item.preview && (
                                <p className="mt-1 text-xs text-aether-muted line-clamp-2 leading-relaxed">
                                  {item.preview}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-aether-border px-3 py-2.5 ml-8 mr-2 mb-2 space-y-2 max-h-56 overflow-y-auto">
                          {item.sampleMessages.length === 0 ? (
                            <p className="text-xs text-aether-muted">No message preview.</p>
                          ) : (
                            item.sampleMessages.map((msg, idx) => (
                              <div key={idx} className="text-xs leading-relaxed">
                                <span
                                  className={clsx(
                                    'font-medium',
                                    msg.role === 'user' ? 'text-aether-text' : 'text-aether-muted',
                                  )}
                                >
                                  {msg.role === 'user' ? 'You' : 'Assistant'}
                                </span>
                                <p className="mt-0.5 whitespace-pre-wrap text-aether-muted">
                                  {msg.content}
                                </p>
                              </div>
                            ))
                          )}
                          {item.messageCount > item.sampleMessages.length && (
                            <p className="text-[10px] text-aether-muted">
                              Showing first {item.sampleMessages.length} of {item.messageCount}{' '}
                              messages.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-aether-border px-6 py-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={committing}
                className="rounded-lg border border-aether-border px-4 py-2 text-sm hover:bg-aether-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={selected.size === 0 || committing || !sessionId}
                className="rounded-lg bg-aether-accent px-4 py-2 text-sm font-medium text-aether-bg hover:opacity-90 disabled:opacity-50"
              >
                {committing
                  ? 'Importing…'
                  : `Import ${selected.size || ''} conversation${selected.size === 1 ? '' : 's'}`.trim()}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
