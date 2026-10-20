import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GitBranch, Sparkles, User, X } from 'lucide-react';
import clsx from 'clsx';
import { formatMessageTime, type Conversation } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import {
  buildConversationGraph,
  findBranchTargetForMessage,
  FLOW_WINDOW_EXPAND,
  FLOW_WINDOW_INITIAL,
  layoutConversationGraph,
  messageNodeLabel,
  messageNodeTitle,
  sliceConversationForFlow,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
} from '../lib/conversation-graph';
import { ROOT_PARENT_ID } from '../lib/branches';

interface Props {
  conversation: Conversation;
  onClose: () => void;
  onNavigateToMessage: (messageId: string) => void;
}

function nodeCenter(layout: { x: number; y: number }) {
  return {
    x: layout.x + GRAPH_NODE_WIDTH / 2,
    y: layout.y + GRAPH_NODE_HEIGHT / 2,
  };
}

export function ChatFlowchartModal({ conversation, onClose, onNavigateToMessage }: Props) {
  const { switchBranch, activeConversationId, streamingConversationId } = useAppStore();
  const isStreaming = Boolean(
    streamingConversationId &&
    activeConversationId &&
    streamingConversationId === activeConversationId,
  );

  const total = conversation.messages.length;
  const needsWindow = total > FLOW_WINDOW_INITIAL;

  // Default: tail of the active path
  const [start, setStart] = useState(() =>
    needsWindow ? Math.max(0, total - FLOW_WINDOW_INITIAL) : 0,
  );
  const [end, setEnd] = useState(() => total);

  // Keep end glued to live length when the chat grows while open
  useEffect(() => {
    setEnd((prev) => (prev >= total - 1 || prev === 0 ? total : Math.min(prev, total)));
    setStart((prev) => Math.min(prev, Math.max(0, total - 1)));
  }, [total]);

  const windowStart = needsWindow ? start : 0;
  const windowEnd = needsWindow ? end : total;
  const earlierCount = windowStart;
  const laterCount = Math.max(0, total - windowEnd);

  const sliced = useMemo(
    () => sliceConversationForFlow(conversation, windowStart, windowEnd),
    [conversation, windowStart, windowEnd],
  );

  const layout = useMemo(() => {
    const graph = buildConversationGraph(sliced);
    return layoutConversationGraph(graph);
  }, [sliced]);

  const positionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of layout.nodes) {
      map.set(node.id, { x: node.x, y: node.y });
    }
    map.set(ROOT_PARENT_ID, {
      x: layout.width / 2 - GRAPH_NODE_WIDTH / 2,
      y: -GRAPH_NODE_HEIGHT,
    });
    return map;
  }, [layout.nodes, layout.width]);

  const handleNodeClick = async (messageId: string) => {
    if (isStreaming) return;

    const branchTarget = findBranchTargetForMessage(conversation, messageId);
    if (branchTarget) {
      await switchBranch(branchTarget.parentMessageId, branchTarget.target);
    }

    onNavigateToMessage(messageId);
    onClose();
  };

  const loadEarlier = () => {
    setStart((s) => Math.max(0, s - FLOW_WINDOW_EXPAND));
  };

  const loadLater = () => {
    setEnd((e) => Math.min(total, e + FLOW_WINDOW_EXPAND));
  };

  const jumpLatest = () => {
    setStart(Math.max(0, total - FLOW_WINDOW_INITIAL));
    setEnd(total);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={onClose} />
      <div className="relative flex h-[min(88vh,720px)] w-full max-w-5xl flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex shrink-0 items-center justify-between border-b border-aether-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Conversation flow</h2>
            <p className="mt-0.5 text-xs text-aether-muted">
              {needsWindow
                ? `Showing messages ${windowStart + 1}–${windowEnd} of ${total}. Highlighted path is the current branch.`
                : 'All messages in this chat. Highlighted path is your current branch. Click a node to jump there.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
            aria-label="Close flowchart"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {needsWindow && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-aether-border px-4 py-2">
            <button
              type="button"
              disabled={earlierCount === 0}
              onClick={loadEarlier}
              className="inline-flex items-center gap-1 rounded-full border border-aether-border px-2.5 py-1 text-[11px] text-aether-muted hover:text-aether-text disabled:opacity-40"
            >
              <ChevronUp className="h-3 w-3" />
              Earlier ({earlierCount.toLocaleString()})
            </button>
            <button
              type="button"
              disabled={laterCount === 0}
              onClick={loadLater}
              className="inline-flex items-center gap-1 rounded-full border border-aether-border px-2.5 py-1 text-[11px] text-aether-muted hover:text-aether-text disabled:opacity-40"
            >
              <ChevronDown className="h-3 w-3" />
              Later ({laterCount.toLocaleString()})
            </button>
            <button
              type="button"
              disabled={laterCount === 0 && windowEnd === total}
              onClick={jumpLatest}
              className="inline-flex items-center gap-1 rounded-full border border-aether-border px-2.5 py-1 text-[11px] text-aether-muted hover:text-aether-text disabled:opacity-40"
            >
              Jump to latest
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <svg
            width={layout.width}
            height={layout.height}
            className="mx-auto block"
            role="img"
            aria-label="Conversation message flowchart"
          >
            {layout.edges.map((edge) => {
              const fromPos = positionById.get(edge.fromId);
              const toPos = positionById.get(edge.toId);
              if (!fromPos || !toPos) return null;

              const from = nodeCenter(fromPos);
              const to = nodeCenter(toPos);
              const midY = (from.y + to.y) / 2;

              return (
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  d={`M ${from.x} ${from.y + GRAPH_NODE_HEIGHT / 2} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - GRAPH_NODE_HEIGHT / 2}`}
                  fill="none"
                  strokeWidth={edge.isActive ? 2 : 1.5}
                  className={clsx(
                    edge.isActive ? 'stroke-aether-text/70' : 'stroke-aether-border',
                  )}
                />
              );
            })}

            {layout.nodes.map((node) => {
              const isUser = node.message.role === 'user';
              const title = messageNodeTitle(node.message);
              const label = messageNodeLabel(node.message);
              const timestamp = node.message.createdAt
                ? formatMessageTime(node.message.createdAt)
                : null;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={clsx(
                    'cursor-pointer transition-opacity',
                    !node.isActive && 'opacity-55 hover:opacity-80',
                    isStreaming && 'pointer-events-none opacity-40',
                  )}
                  onClick={() => void handleNodeClick(node.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${title}: ${label}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleNodeClick(node.id);
                    }
                  }}
                >
                  <rect
                    width={GRAPH_NODE_WIDTH}
                    height={GRAPH_NODE_HEIGHT}
                    rx={10}
                    className={clsx(
                      'fill-aether-bg stroke-aether-border',
                      node.isActive && 'stroke-aether-text/60',
                      isUser ? 'stroke-aether-border' : 'stroke-aether-muted/40',
                    )}
                    strokeWidth={node.isActive ? 2 : 1}
                  />
                  <foreignObject
                    x={10}
                    y={8}
                    width={GRAPH_NODE_WIDTH - 20}
                    height={GRAPH_NODE_HEIGHT - 16}
                  >
                    <div className="flex h-full flex-col justify-center gap-0.5 overflow-hidden">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isUser ? (
                          <User className="h-3 w-3 shrink-0 text-aether-muted" />
                        ) : (
                          <Sparkles className="h-3 w-3 shrink-0 text-aether-muted" />
                        )}
                        <span className="truncate text-[11px] font-semibold text-aether-text">
                          {title}
                        </span>
                        {node.message.branchCount && node.message.branchCount > 1 ? (
                          <GitBranch
                            className="h-3 w-3 shrink-0 text-aether-muted"
                            aria-hidden
                          />
                        ) : null}
                      </div>
                      <span className="truncate text-[10px] leading-tight text-aether-muted">
                        {label}
                      </span>
                      {timestamp && (
                        <span className="truncate text-[9px] tabular-nums text-aether-muted/80">
                          {timestamp}
                        </span>
                      )}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
