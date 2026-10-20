import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Copy,
  Link2,
  Network,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  NoteNode,
  NotesScopeRef,
  NotesTrashItem,
  NotesVault,
  ToolScopeConfig,
} from '@aether/shared';
import { NOTES_ACCESS_LABELS } from '@aether/shared';
import { api } from '../../lib/api';
import { useAppStore } from '../../store/app-store';
import { NotesGraphCanvas } from './NotesGraphCanvas';

interface Props {
  onBack: () => void;
  onClose: () => void;
}

type ScopeTab = 'root' | 'conversation';
type Panel = 'editor' | 'graph' | 'trash';

export function NotesGraphView({ onBack, onClose }: Props) {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const activeConversation = useAppStore((s) => s.activeConversation);

  const [scopeTab, setScopeTab] = useState<ScopeTab>(
    activeConversationId ? 'conversation' : 'root',
  );
  const [panel, setPanel] = useState<Panel>('editor');
  const [vault, setVault] = useState<NotesVault | null>(null);
  const [effective, setEffective] = useState<ToolScopeConfig | null>(null);
  const [trash, setTrash] = useState<NotesTrashItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftType, setDraftType] = useState('');

  const personaId = activeConversation?.activePersonaId;

  const scope: NotesScopeRef | null = useMemo(() => {
    if (scopeTab === 'root') return { kind: 'root' };
    if (!activeConversationId) return null;
    return { kind: 'conversation', conversationId: activeConversationId };
  }, [scopeTab, activeConversationId]);

  const selected = vault?.nodes.find((n) => n.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!scope) {
      setVault(null);
      return;
    }
    setError(null);
    try {
      const res = await api.getNotesVault({
        scope: scope.kind,
        conversationId:
          scope.kind === 'conversation' ? scope.conversationId : activeConversationId ?? undefined,
        personaId,
      });
      setVault(res.vault);
      setEffective(res.effective);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
      setVault(null);
    }
  }, [scope, activeConversationId, personaId]);

  const loadTrash = useCallback(async () => {
    try {
      const res = await api.listNotesTrash();
      setTrash(res.items);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (panel === 'trash') void loadTrash();
  }, [panel, loadTrash]);

  // Sync editor drafts when selection changes
  useEffect(() => {
    if (selected) {
      setDraftTitle(selected.title);
      setDraftBody(selected.body);
      setDraftType(selected.type ?? '');
    } else {
      setDraftTitle('');
      setDraftBody('');
      setDraftType('');
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only on id change

  const runOp = async (
    op: Parameters<typeof api.notesOp>[0],
    opts?: { selectId?: string | null },
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.notesOp(op, {
        conversationId: activeConversationId ?? undefined,
        personaId,
      });
      if (!result.ok) {
        setError(result.error ?? 'Operation failed');
        return;
      }
      if (result.vault && scope && sameScope(result.vault.scope, scope)) {
        setVault(result.vault);
      } else if (result.rootVault && scope?.kind === 'root') {
        setVault(result.rootVault);
      } else {
        await load();
      }
      if (opts && 'selectId' in opts) {
        setSelectedId(opts.selectId ?? null);
      } else if (result.node) {
        setSelectedId(result.node.id);
      }
      if (panel === 'trash') await loadTrash();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    if (!scope) return;
    void runOp({
      op: 'createNode',
      scope,
      title: 'Untitled note',
      body: '',
    });
  };

  const handleSaveSelected = () => {
    if (!scope || !selected) return;
    void runOp({
      op: 'updateNode',
      scope,
      nodeId: selected.id,
      title: draftTitle,
      body: draftBody,
      type: draftType.trim() ? draftType.trim() : null,
    });
  };

  const handleDeleteSelected = () => {
    if (!scope || !selected) return;
    void runOp(
      { op: 'deleteNode', scope, nodeId: selected.id },
      { selectId: null },
    );
  };

  const handleMove = (direction: 'toRoot' | 'toChat', mode: 'move' | 'copy' = 'move') => {
    if (!selected || !scope) return;
    if (direction === 'toRoot') {
      if (scope.kind !== 'conversation') return;
      void runOp(
        {
          op: 'moveNode',
          from: scope,
          to: { kind: 'root' },
          nodeId: selected.id,
          mode,
        },
        { selectId: mode === 'move' ? null : selected.id },
      );
      return;
    }
    if (!activeConversationId || scope.kind !== 'root') return;
    void runOp(
      {
        op: 'moveNode',
        from: scope,
        to: { kind: 'conversation', conversationId: activeConversationId },
        nodeId: selected.id,
        mode,
      },
      { selectId: mode === 'move' ? null : selected.id },
    );
  };

  const handleSelectNode = (id: string | null) => {
    if (linkFromId && id && id !== linkFromId && scope) {
      void runOp({
        op: 'createEdge',
        scope,
        fromId: linkFromId,
        toId: id,
        label: linkLabel.trim() || undefined,
      });
      setLinkFromId(null);
      setLinkLabel('');
      return;
    }
    setSelectedId(id);
  };

  const handleMoveEnd = (positions: Array<{ nodeId: string; x: number; y: number }>) => {
    if (!scope || positions.length === 0) return;
    void runOp({ op: 'setLayout', scope, positions });
  };

  const outgoing = useMemo(() => {
    if (!vault || !selected) return [];
    return vault.edges
      .filter((e) => e.fromId === selected.id || e.toId === selected.id)
      .map((e) => {
        const otherId = e.fromId === selected.id ? e.toId : e.fromId;
        const other = vault.nodes.find((n) => n.id === otherId);
        return { edge: e, other, outbound: e.fromId === selected.id };
      });
  }, [vault, selected]);

  // User UI always allows both scopes; model policy is informational only here.
  const canMoveToRoot = scope?.kind === 'conversation' && Boolean(selected);
  const canMoveToChat = scope?.kind === 'root' && Boolean(selected) && Boolean(activeConversationId);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-aether-muted hover:text-aether-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tools
        </button>
        <div className="flex items-center gap-1.5">
          <Network className="h-4 w-4 text-aether-muted" />
          <span className="text-sm font-semibold">Linked Notes</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scope + panel tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
        <div className="inline-flex rounded-lg border border-aether-border p-0.5">
          <ScopeButton
            active={scopeTab === 'root'}
            onClick={() => setScopeTab('root')}
            label="Root library"
          />
          <ScopeButton
            active={scopeTab === 'conversation'}
            disabled={!activeConversationId}
            onClick={() => setScopeTab('conversation')}
            label={activeConversationId ? 'This chat' : 'This chat (none open)'}
          />
        </div>
        <div className="inline-flex rounded-lg border border-aether-border p-0.5">
          {(['editor', 'graph', 'trash'] as Panel[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPanel(p)}
              className={clsx(
                'px-2.5 py-1 text-xs rounded-md capitalize',
                panel === p
                  ? 'bg-aether-surface-2 text-aether-text'
                  : 'text-aether-muted hover:text-aether-text',
              )}
            >
              {p}
            </button>
          ))}
        </div>
        {effective && (
          <span className="text-[10px] text-aether-muted ml-auto max-w-[14rem] text-right leading-snug">
            Model: {NOTES_ACCESS_LABELS[effective.access]}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {!scope ? (
        <div className="flex-1 flex items-center justify-center text-sm text-aether-muted">
          Open a conversation to use the chat-scoped case file, or switch to Root library.
        </div>
      ) : panel === 'trash' ? (
        <TrashPanel
          items={trash}
          busy={busy}
          onRestore={async (id) => {
            setBusy(true);
            try {
              await api.restoreNotesTrash(id);
              await load();
              await loadTrash();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Restore failed');
            } finally {
              setBusy(false);
            }
          }}
          onEmpty={async () => {
            setBusy(true);
            try {
              await api.emptyNotesTrash();
              await loadTrash();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Empty failed');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : panel === 'graph' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex items-center gap-1 rounded-lg bg-aether-accent text-aether-bg px-2.5 py-1 text-xs font-medium"
            >
              <Plus className="h-3 w-3" /> Note
            </button>
            <button
              type="button"
              disabled={!selected || busy}
              onClick={() => {
                setLinkFromId(selected?.id ?? null);
                setLinkLabel('');
              }}
              className={clsx(
                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs',
                linkFromId
                  ? 'border-aether-tool-active text-aether-tool-active'
                  : 'border-aether-border text-aether-muted',
              )}
            >
              <Link2 className="h-3 w-3" />
              {linkFromId ? 'Click target note…' : 'Link from selected'}
            </button>
            {linkFromId && (
              <>
                <input
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="rounded-md border border-aether-border bg-aether-bg px-2 py-1 text-xs w-36"
                />
                <button
                  type="button"
                  className="text-xs text-aether-muted hover:text-aether-text"
                  onClick={() => setLinkFromId(null)}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
          <div className="flex-1 min-h-[280px]">
            <NotesGraphCanvas
              nodes={vault?.nodes ?? []}
              edges={vault?.edges ?? []}
              selectedId={selectedId}
              linkFromId={linkFromId}
              onSelect={handleSelectNode}
              onMove={() => {}}
              onMoveEnd={handleMoveEnd}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
          {/* List */}
          <div className="flex flex-col min-h-0 rounded-xl border border-aether-border bg-aether-bg">
            <div className="flex items-center justify-between px-2 py-2 border-b border-aether-border">
              <span className="text-[10px] uppercase tracking-wide text-aether-muted px-1">
                Notes ({vault?.nodes.length ?? 0})
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={handleCreate}
                className="rounded-md p-1 text-aether-muted hover:text-aether-text"
                title="New note"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {(vault?.nodes ?? []).length === 0 ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-aether-muted">
                    Empty board. Drop a person, clue, or place — or ask the model to pin what it finds.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(['person', 'clue', 'place', 'question'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          scope &&
                          void runOp({
                            op: 'createNode',
                            scope,
                            title: t === 'question' ? 'Open question' : `New ${t}`,
                            type: t,
                            body: '',
                          })
                        }
                        className="rounded-md border border-aether-border px-2 py-0.5 text-[10px] text-aether-muted hover:text-aether-text capitalize"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                (vault?.nodes ?? []).map((n) => (
                  <NoteListItem
                    key={n.id}
                    node={n}
                    active={n.id === selectedId}
                    onClick={() => setSelectedId(n.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-col min-h-0 rounded-xl border border-aether-border bg-aether-bg p-3">
            {!selected ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-aether-muted px-6 text-center">
                <Network className="h-8 w-8 opacity-40" />
                <p>Select a note or create one.</p>
                <p className="text-xs max-w-xs">
                  Link notes deliberately on the Graph tab. The model can pin and connect here from chat too.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-2">
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={handleSaveSelected}
                    className="flex-1 min-w-[120px] rounded-lg border border-aether-border bg-aether-surface px-3 py-1.5 text-sm font-medium"
                    placeholder="Title"
                  />
                  <input
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                    onBlur={handleSaveSelected}
                    className="w-28 rounded-lg border border-aether-border bg-aether-surface px-2 py-1.5 text-xs"
                    placeholder="Type"
                    title="Optional type: person, clue, place…"
                  />
                </div>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  onBlur={handleSaveSelected}
                  className="flex-1 min-h-[140px] resize-none rounded-lg border border-aether-border bg-aether-surface px-3 py-2 text-sm leading-relaxed"
                  placeholder="Write freely. Links are created deliberately on the graph — not from [[wikilinks]]."
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveSelected}
                    className="rounded-lg bg-aether-accent text-aether-bg px-3 py-1.5 text-xs font-medium"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPanel('graph');
                      setLinkFromId(selected.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-aether-border px-3 py-1.5 text-xs text-aether-muted hover:text-aether-text"
                  >
                    <Link2 className="h-3 w-3" /> Link on graph
                  </button>
                  {canMoveToRoot && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMove('toRoot', 'move')}
                        className="inline-flex items-center gap-1 rounded-lg border border-aether-border px-3 py-1.5 text-xs text-aether-muted hover:text-aether-text"
                        title="Move this note into the root library"
                      >
                        <ArrowUpFromLine className="h-3 w-3" /> To root
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMove('toRoot', 'copy')}
                        className="inline-flex items-center gap-1 rounded-lg border border-aether-border px-2 py-1.5 text-xs text-aether-muted hover:text-aether-text"
                        title="Copy into the root library"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  {canMoveToChat && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMove('toChat', 'move')}
                        className="inline-flex items-center gap-1 rounded-lg border border-aether-border px-3 py-1.5 text-xs text-aether-muted hover:text-aether-text"
                        title="Move this note into the open chat’s case file"
                      >
                        <ArrowDownToLine className="h-3 w-3" /> To this chat
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMove('toChat', 'copy')}
                        className="inline-flex items-center gap-1 rounded-lg border border-aether-border px-2 py-1.5 text-xs text-aether-muted hover:text-aether-text"
                        title="Copy into this chat"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDeleteSelected}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300/90 hover:bg-red-500/10 ml-auto"
                  >
                    <Trash2 className="h-3 w-3" /> Trash
                  </button>
                </div>

                {outgoing.length > 0 && (
                  <div className="mt-3 border-t border-aether-border pt-2">
                    <div className="text-[10px] uppercase tracking-wide text-aether-muted mb-1">
                      Links
                    </div>
                    <ul className="space-y-1">
                      {outgoing.map(({ edge, other, outbound }) => (
                        <li
                          key={edge.id}
                          className="flex items-center gap-2 text-xs text-aether-muted"
                        >
                          <span className="text-aether-text/80">
                            {outbound ? '→' : '←'} {other?.title ?? '…'}
                          </span>
                          {edge.label && (
                            <span className="text-[10px] bg-aether-surface-2 px-1.5 rounded">
                              {edge.label}
                            </span>
                          )}
                          <button
                            type="button"
                            className="ml-auto text-[10px] hover:text-red-300"
                            onClick={() =>
                              scope &&
                              void runOp({ op: 'deleteEdge', scope, edgeId: edge.id })
                            }
                          >
                            Unlink
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function sameScope(a: NotesScopeRef, b: NotesScopeRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'root') return true;
  return a.conversationId === b.conversationId;
}

function ScopeButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 text-xs rounded-md',
        disabled && 'opacity-40 cursor-not-allowed',
        active ? 'bg-aether-surface-2 text-aether-text' : 'text-aether-muted hover:text-aether-text',
      )}
    >
      {label}
    </button>
  );
}

function NoteListItem({
  node,
  active,
  onClick,
}: {
  node: NoteNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors',
        active ? 'bg-aether-surface-2' : 'hover:bg-aether-surface-2/60',
      )}
    >
      <div className="text-xs font-medium truncate">{node.title}</div>
      {node.type && (
        <div className="text-[10px] text-aether-muted truncate mt-0.5">{node.type}</div>
      )}
    </button>
  );
}

function TrashPanel({
  items,
  busy,
  onRestore,
  onEmpty,
}: {
  items: NotesTrashItem[];
  busy: boolean;
  onRestore: (id: string) => void;
  onEmpty: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-aether-border bg-aether-bg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-aether-border">
        <span className="text-xs text-aether-muted">Trash ({items.length})</span>
        <button
          type="button"
          disabled={busy || items.length === 0}
          onClick={onEmpty}
          className="text-[10px] text-red-300/80 hover:text-red-200 disabled:opacity-40"
        >
          Empty trash
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-aether-muted p-3">Trash is empty.</p>
        ) : (
          items.map((item) => {
            const label =
              item.entityType === 'node'
                ? (item.entity as NoteNode).title
                : `Link ${(item.entity as { label?: string }).label ?? '(unlabeled)'}`;
            const scopeLabel =
              item.scope.kind === 'root'
                ? 'root'
                : `chat ${item.scope.conversationId?.slice(0, 8) ?? '?'}`;
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-aether-border px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate">{label}</div>
                  <div className="text-[10px] text-aether-muted">
                    {item.entityType} · {scopeLabel}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(item.id)}
                  className="inline-flex items-center gap-1 text-[10px] text-aether-muted hover:text-aether-text"
                >
                  <Undo2 className="h-3 w-3" /> Restore
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
