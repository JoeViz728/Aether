import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import type { NoteEdge, NoteNode } from '@aether/shared';

const NODE_W = 140;
const NODE_H = 48;

interface Props {
  nodes: NoteNode[];
  edges: NoteEdge[];
  selectedId: string | null;
  linkFromId: string | null;
  onSelect: (nodeId: string | null) => void;
  onMove: (nodeId: string, x: number, y: number) => void;
  onMoveEnd: (positions: Array<{ nodeId: string; x: number; y: number }>) => void;
}

function ensurePositions(nodes: NoteNode[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  const missing: NoteNode[] = [];
  for (const n of nodes) {
    if (typeof n.x === 'number' && typeof n.y === 'number') {
      map.set(n.id, { x: n.x, y: n.y });
    } else {
      missing.push(n);
    }
  }
  // Simple grid for unpositioned nodes
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(nodes.length, 1))));
  missing.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    map.set(n.id, { x: 40 + col * (NODE_W + 48), y: 40 + row * (NODE_H + 56) });
  });
  return map;
}

export function NotesGraphCanvas({
  nodes,
  edges,
  selectedId,
  linkFromId,
  onSelect,
  onMove,
  onMoveEnd,
}: Props) {
  const positions = useMemo(() => ensurePositions(nodes), [nodes]);
  const dragRef = useRef<{
    id: string;
    ox: number;
    oy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [live, setLive] = useState<Map<string, { x: number; y: number }> | null>(null);
  const pos = live ?? positions;

  const bounds = useMemo(() => {
    let maxX = 400;
    let maxY = 280;
    for (const p of pos.values()) {
      maxX = Math.max(maxX, p.x + NODE_W + 80);
      maxY = Math.max(maxY, p.y + NODE_H + 80);
    }
    return { w: maxX, h: maxY };
  }, [pos]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, nodeId: string) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = pos.get(nodeId) ?? { x: 0, y: 0 };
      dragRef.current = {
        id: nodeId,
        ox: e.clientX,
        oy: e.clientY,
        startX: p.x,
        startY: p.y,
        moved: false,
      };
      onSelect(nodeId);
    },
    [onSelect, pos],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGGElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.ox;
      const dy = e.clientY - d.oy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      const x = d.startX + dx;
      const y = d.startY + dy;
      setLive((prev) => {
        const base = prev ?? new Map(positions);
        const next = new Map(base);
        next.set(d.id, { x, y });
        return next;
      });
      onMove(d.id, x, y);
    },
    [onMove, positions],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGGElement>) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (d.moved && live) {
        const entries = [...live.entries()].map(([nodeId, p]) => ({
          nodeId,
          x: p.x,
          y: p.y,
        }));
        onMoveEnd(entries);
      }
      setLive(null);
    },
    [live, onMoveEnd],
  );

  return (
    <div
      className="h-full w-full overflow-auto rounded-xl border border-aether-border bg-aether-bg"
      onClick={() => onSelect(null)}
    >
      <svg width={bounds.w} height={bounds.h} className="block min-w-full min-h-full">
        {edges.map((edge) => {
          const from = pos.get(edge.fromId);
          const to = pos.get(edge.toId);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return (
            <g key={edge.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-aether-border)"
                strokeWidth={1.5}
              />
              {edge.label && (
                <text
                  x={mx}
                  y={my - 6}
                  textAnchor="middle"
                  className="fill-aether-muted"
                  style={{ fontSize: 10 }}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const p = pos.get(node.id) ?? { x: 0, y: 0 };
          const selected = selectedId === node.id;
          const linking = linkFromId === node.id;
          return (
            <g
              key={node.id}
              transform={`translate(${p.x}, ${p.y})`}
              onPointerDown={(e) => handlePointerDown(e, node.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{ cursor: 'grab' }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                className={clsx(
                  selected || linking ? 'stroke-aether-tool-active' : 'stroke-aether-border',
                )}
                fill="var(--color-aether-surface)"
                strokeWidth={selected || linking ? 2 : 1}
              />
              <text
                x={NODE_W / 2}
                y={NODE_H / 2 - (node.type ? 4 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-aether-text pointer-events-none"
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                {node.title.length > 18 ? `${node.title.slice(0, 16)}…` : node.title}
              </text>
              {node.type && (
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 12}
                  textAnchor="middle"
                  className="fill-aether-muted pointer-events-none"
                  style={{ fontSize: 9 }}
                >
                  {node.type}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
