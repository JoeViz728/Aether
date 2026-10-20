import { Network, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import type { MessageAugmentation } from '@aether/shared';
import { NOTES_TOOL_ID, NOTES_TOOL_KIND } from '@aether/shared';
import { useAppStore } from '../../store/app-store';

interface Props {
  augmentation: MessageAugmentation;
}

function isNotesAug(a: MessageAugmentation): boolean {
  return a.toolId === NOTES_TOOL_ID || a.kind === NOTES_TOOL_KIND;
}

export function NotesAugmentationCard({ augmentation }: Props) {
  const setToolsOpen = useAppStore((s) => s.setToolsOpen);

  if (!isNotesAug(augmentation)) return null;

  const p = augmentation.payload as {
    view?: string;
    title?: string;
    type?: string;
    bodyPreview?: string;
    tags?: string[];
    nodes?: Array<{ id: string; title: string; type?: string; bodyPreview?: string }>;
    edges?: Array<{ id: string; fromId: string; toId: string; label?: string }>;
    preview?: { nodeCount?: number; edgeCount?: number; nodes?: Array<{ title: string; type?: string }> };
    scope?: { kind?: string };
  };

  const openNotes = () => setToolsOpen(true);

  const scopeLabel = p.scope?.kind === 'conversation' ? 'This chat' : 'Root library';

  if (p.view === 'subgraph' && p.nodes?.length) {
    const focus = p.nodes[0];
    return (
      <button
        type="button"
        onClick={openNotes}
        className="mt-2 w-full max-w-md text-left rounded-xl border border-aether-border bg-aether-tool/40 hover:border-aether-tool-active/50 transition-colors p-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Network className="h-3.5 w-3.5 text-aether-tool-active" />
          <span className="text-xs font-medium">Notes subgraph</span>
          <span className="text-[10px] text-aether-muted ml-auto">{scopeLabel}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {p.nodes.slice(0, 8).map((n) => (
            <span
              key={n.id}
              className={clsx(
                'rounded-md px-2 py-0.5 text-[11px] border border-aether-border bg-aether-surface',
                n.id === focus?.id && 'border-aether-tool-active/60',
              )}
            >
              {n.title}
            </span>
          ))}
        </div>
        {p.edges && p.edges.length > 0 && (
          <div className="text-[10px] text-aether-muted space-y-0.5">
            {p.edges.slice(0, 5).map((e) => {
              const from = p.nodes?.find((n) => n.id === e.fromId)?.title ?? '…';
              const to = p.nodes?.find((n) => n.id === e.toId)?.title ?? '…';
              return (
                <div key={e.id}>
                  {from} {e.label ? `—${e.label}→` : '→'} {to}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-aether-muted">
          <ExternalLink className="h-3 w-3" /> Open Linked Notes
        </div>
      </button>
    );
  }

  if (p.view === 'vault') {
    const count = p.preview?.nodeCount ?? p.nodes?.length ?? 0;
    const edges = p.preview?.edgeCount ?? p.edges?.length ?? 0;
    const titles = p.preview?.nodes ?? p.nodes ?? [];
    return (
      <button
        type="button"
        onClick={openNotes}
        className="mt-2 w-full max-w-md text-left rounded-xl border border-aether-border bg-aether-tool/40 hover:border-aether-tool-active/50 transition-colors p-3"
      >
        <div className="flex items-center gap-2 mb-1">
          <Network className="h-3.5 w-3.5 text-aether-tool-active" />
          <span className="text-xs font-medium">Notes vault</span>
          <span className="text-[10px] text-aether-muted ml-auto">
            {count} notes · {edges} links · {scopeLabel}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {titles.slice(0, 10).map((n, i) => (
            <span
              key={`${n.title}-${i}`}
              className="rounded-md px-2 py-0.5 text-[11px] border border-aether-border bg-aether-surface"
            >
              {n.title}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10px] text-aether-muted">
          <ExternalLink className="h-3 w-3" /> Open Linked Notes
        </div>
      </button>
    );
  }

  // node card (default)
  return (
    <button
      type="button"
      onClick={openNotes}
      className="mt-2 w-full max-w-md text-left rounded-xl border border-aether-border bg-aether-tool/40 hover:border-aether-tool-active/50 transition-colors p-3"
    >
      <div className="flex items-center gap-2 mb-1">
        <Network className="h-3.5 w-3.5 text-aether-tool-active" />
        <span className="text-xs font-medium truncate">{p.title ?? 'Note'}</span>
        {p.type && (
          <span className="text-[10px] uppercase tracking-wide text-aether-muted bg-aether-surface px-1.5 py-px rounded">
            {p.type}
          </span>
        )}
        <span className="text-[10px] text-aether-muted ml-auto">{scopeLabel}</span>
      </div>
      {p.bodyPreview && (
        <p className="text-xs text-aether-muted line-clamp-3 whitespace-pre-wrap">{p.bodyPreview}</p>
      )}
      {p.tags && p.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <span key={t} className="text-[10px] text-aether-muted bg-aether-surface px-1.5 rounded">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-aether-muted">
        <ExternalLink className="h-3 w-3" /> Open Linked Notes
      </div>
    </button>
  );
}

export function MessageAugmentations({ items }: { items?: MessageAugmentation[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1 space-y-1">
      {items.map((a) => (
        <NotesAugmentationCard key={a.id} augmentation={a} />
      ))}
    </div>
  );
}
