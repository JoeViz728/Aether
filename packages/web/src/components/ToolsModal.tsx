import { useEffect, useState } from 'react';
import { X, Wrench, Play, ExternalLink, ArrowLeft, Network } from 'lucide-react';
import clsx from 'clsx';
import type { Tool } from '@aether/shared';
import { NOTES_TOOL_ID, NOTES_TOOL_KIND } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { NotesGraphView } from './notes/NotesGraphView';

interface ToolCardProps {
  tool: Tool;
  onLaunch: (tool: Tool) => void;
}

function ToolCard({ tool, onLaunch }: ToolCardProps) {
  const Icon = tool.kind === NOTES_TOOL_KIND || tool.id === NOTES_TOOL_ID ? Network : Wrench;

  return (
    <div className="rounded-xl border border-aether-border bg-aether-surface p-4 flex flex-col gap-2 hover:border-aether-border/70 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-aether-surface-2 p-2 text-aether-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm truncate">{tool.name}</div>
            {tool.kind && (
              <span className="text-[10px] uppercase tracking-wide text-aether-muted bg-aether-surface-2 px-1.5 py-px rounded">
                {tool.kind}
              </span>
            )}
          </div>
          <p className="text-xs text-aether-muted mt-0.5 line-clamp-2">{tool.description}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-aether-muted">
            {tool.owner === 'model' && <span className="text-amber-400">Model-created</span>}
            {!tool.enabled && <span className="text-red-400/70">Disabled</span>}
          </div>
        </div>
      </div>

      <div className="mt-auto pt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onLaunch(tool)}
          disabled={!tool.enabled}
          className={clsx(
            'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            tool.enabled
              ? 'bg-aether-accent text-aether-bg hover:opacity-90'
              : 'bg-aether-surface-2 text-aether-muted cursor-not-allowed',
          )}
        >
          <Play className="h-3 w-3" />
          Launch full view
        </button>
        <button
          type="button"
          onClick={() => onLaunch(tool)}
          className="rounded-lg border border-aether-border px-2.5 py-1.5 text-xs text-aether-muted hover:text-aether-text hover:bg-aether-surface-2"
          title="Open details"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ToolsModal() {
  const {
    toolsOpen,
    setToolsOpen,
    tools,
    loadTools,
  } = useAppStore();

  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  useEffect(() => {
    if (toolsOpen) {
      void loadTools();
      setSelectedTool(null);
    }
  }, [toolsOpen, loadTools]);

  if (!toolsOpen) return null;

  const builtinTools = tools.filter((t) => t.id.startsWith('builtin:'));
  const customTools = tools.filter((t) => !t.id.startsWith('builtin:'));

  const handleLaunch = (tool: Tool) => {
    setSelectedTool(tool);
  };

  const closeViewer = () => setSelectedTool(null);

  const isNotesTool =
    selectedTool &&
    (selectedTool.id === NOTES_TOOL_ID || selectedTool.kind === NOTES_TOOL_KIND);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={() => setToolsOpen(false)} />
      <div
        className={clsx(
          'relative w-full rounded-2xl border border-aether-border bg-aether-surface p-6 shadow-2xl animate-fade-in max-h-[90vh] overflow-hidden flex flex-col',
          isNotesTool ? 'max-w-5xl h-[min(90vh,820px)]' : 'max-w-3xl',
        )}
      >
        {isNotesTool ? (
          <NotesGraphView onBack={closeViewer} onClose={() => setToolsOpen(false)} />
        ) : (
          <>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-aether-surface-2 p-2">
                  <Wrench className="h-5 w-5 text-aether-muted" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Tools &amp; Automation</h2>
                  <p className="text-xs text-aether-muted">
                    Capabilities the model can use and you can launch
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setToolsOpen(false)}
                className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedTool ? (
              <div className="flex-1 overflow-y-auto pr-1 -mr-1">
                <button
                  type="button"
                  onClick={closeViewer}
                  className="mb-3 flex items-center gap-1 text-xs text-aether-muted hover:text-aether-text"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to list
                </button>

                <div className="rounded-2xl border border-aether-border bg-aether-bg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-lg bg-aether-surface p-2.5">
                      <Wrench className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-semibold">{selectedTool.name}</div>
                      <div className="text-xs text-aether-muted">
                        {selectedTool.kind ?? 'custom tool'} •{' '}
                        {selectedTool.owner === 'model' ? 'Created by model' : 'Built-in / custom'}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-aether-muted mb-6">{selectedTool.description}</p>

                  <div className="rounded-xl border border-dashed border-aether-border bg-aether-surface/60 p-8 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-aether-surface">
                      <Play className="h-5 w-5 text-aether-muted" />
                    </div>
                    <div className="font-medium mb-1">Full tool view</div>
                    <p className="text-xs max-w-xs mx-auto text-aether-muted">
                      This tool does not have a dedicated workspace UI yet. Built-in search and code
                      tools run from chat; Linked Notes has a full graph editor.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-6">
                <section>
                  <div className="text-xs uppercase tracking-wide text-aether-muted mb-2 px-1">
                    Built-in
                  </div>
                  {builtinTools.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {builtinTools.map((tool) => (
                        <ToolCard key={tool.id} tool={tool} onLaunch={handleLaunch} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-aether-muted px-1">No built-in tools listed.</div>
                  )}
                </section>

                <section>
                  <div className="text-xs uppercase tracking-wide text-aether-muted mb-2 px-1 flex items-center justify-between">
                    <span>Model-created &amp; custom</span>
                    <span className="normal-case text-[10px] text-aether-muted/70">
                      ({customTools.length})
                    </span>
                  </div>
                  {customTools.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {customTools.map((tool) => (
                        <ToolCard key={tool.id} tool={tool} onLaunch={handleLaunch} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-aether-border p-4 text-sm text-aether-muted">
                      No custom tools yet. When the model needs capabilities beyond the built-ins, it
                      can create and update tools here (with your approval for structural builds).
                    </div>
                  )}
                </section>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-aether-border text-[11px] text-aether-muted shrink-0">
              Tools can augment chat messages (e.g. render charts or boards inside the conversation)
              or be opened in a dedicated full view. Resource-backed tools support root +
              conversation scopes.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
