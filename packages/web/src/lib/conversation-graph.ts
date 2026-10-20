import type { ChatMessage, Conversation } from '@aether/shared';
import { getMessageSortTime } from '@aether/shared';
import { ROOT_PARENT_ID } from './branches';

export interface ConversationGraph {
  messages: Map<string, ChatMessage>;
  children: Map<string, string[]>;
  parent: Map<string, string>;
  activeMessageIds: Set<string>;
  activeEdges: Set<string>;
}

export interface GraphNodeLayout {
  id: string;
  x: number;
  y: number;
  message: ChatMessage;
  isActive: boolean;
}

export interface GraphEdgeLayout {
  fromId: string;
  toId: string;
  isActive: boolean;
}

export interface GraphLayout {
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
  width: number;
  height: number;
}

export const GRAPH_NODE_WIDTH = 148;
export const GRAPH_NODE_HEIGHT = 62;
export const GRAPH_H_GAP = 20;
export const GRAPH_V_GAP = 44;

function edgeKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

function linkChild(children: Map<string, string[]>, parentId: string, childId: string): void {
  const list = children.get(parentId) ?? [];
  if (!list.includes(childId)) {
    list.push(childId);
    children.set(parentId, list);
  }
}

function addSequence(
  parentId: string,
  tail: ChatMessage[],
  messages: Map<string, ChatMessage>,
  children: Map<string, string[]>,
  parent: Map<string, string>,
): void {
  let prevId = parentId;

  for (const msg of tail) {
    messages.set(msg.id, msg);

    if (!parent.has(msg.id)) {
      parent.set(msg.id, prevId);
    }

    linkChild(children, prevId, msg.id);
    prevId = msg.id;
  }
}

export function buildConversationGraph(conversation: Conversation): ConversationGraph {
  const messages = new Map<string, ChatMessage>();
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();

  addSequence(ROOT_PARENT_ID, conversation.messages, messages, children, parent);

  for (const point of conversation.branchPoints ?? []) {
    for (const branch of point.archived) {
      addSequence(point.parentMessageId, branch.tail, messages, children, parent);
    }
    if (point.liveTail?.length) {
      addSequence(point.parentMessageId, point.liveTail, messages, children, parent);
    }
  }

  const activeMessageIds = new Set(conversation.messages.map((m) => m.id));
  const activeEdges = new Set<string>();

  if (conversation.messages.length > 0) {
    activeEdges.add(edgeKey(ROOT_PARENT_ID, conversation.messages[0].id));
    for (let i = 1; i < conversation.messages.length; i++) {
      activeEdges.add(edgeKey(conversation.messages[i - 1].id, conversation.messages[i].id));
    }
  }

  for (const [, childIds] of children) {
    if (childIds.length < 2) continue;
    childIds.sort((a, b) => {
      const delta = getMessageSortTime(messages.get(a)) - getMessageSortTime(messages.get(b));
      return delta !== 0 ? delta : a.localeCompare(b);
    });
  }

  return { messages, children, parent, activeMessageIds, activeEdges };
}

export function findBranchTargetForMessage(
  conversation: Conversation,
  messageId: string,
): { parentMessageId: string; target: 'live' | string } | null {
  if (conversation.messages.some((m) => m.id === messageId)) {
    return null;
  }

  for (const point of conversation.branchPoints ?? []) {
    for (const branch of point.archived) {
      if (branch.tail.some((m) => m.id === messageId)) {
        return { parentMessageId: point.parentMessageId, target: branch.id };
      }
    }
    if (point.liveTail?.some((m) => m.id === messageId)) {
      return { parentMessageId: point.parentMessageId, target: 'live' };
    }
  }

  return null;
}

function layoutSubtree(
  nodeId: string,
  depth: number,
  leftX: number,
  graph: ConversationGraph,
  positions: Map<string, { x: number; y: number }>,
): { width: number } {
  const childIds = graph.children.get(nodeId) ?? [];

  if (childIds.length === 0) {
    if (nodeId !== ROOT_PARENT_ID) {
      positions.set(nodeId, {
        x: leftX,
        y: depth * (GRAPH_NODE_HEIGHT + GRAPH_V_GAP),
      });
    }
    return { width: GRAPH_NODE_WIDTH };
  }

  let x = leftX;
  const widths: number[] = [];

  for (const childId of childIds) {
    const result = layoutSubtree(childId, depth + 1, x, graph, positions);
    widths.push(result.width);
    x += result.width + GRAPH_H_GAP;
  }

  const totalWidth = Math.max(
    GRAPH_NODE_WIDTH,
    widths.reduce((sum, w) => sum + w, 0) + GRAPH_H_GAP * Math.max(0, childIds.length - 1),
  );

  if (nodeId !== ROOT_PARENT_ID) {
    const nodeX = leftX + totalWidth / 2 - GRAPH_NODE_WIDTH / 2;
    positions.set(nodeId, {
      x: nodeX,
      y: depth * (GRAPH_NODE_HEIGHT + GRAPH_V_GAP),
    });
  }

  return { width: totalWidth };
}

export function layoutConversationGraph(graph: ConversationGraph): GraphLayout {
  const positions = new Map<string, { x: number; y: number }>();
  const tree = layoutSubtree(ROOT_PARENT_ID, -1, 0, graph, positions);

  const nodes: GraphNodeLayout[] = [];
  for (const [id, message] of graph.messages) {
    const pos = positions.get(id);
    if (!pos) continue;
    nodes.push({
      id,
      x: pos.x,
      y: pos.y,
      message,
      isActive: graph.activeMessageIds.has(id),
    });
  }

  const edges: GraphEdgeLayout[] = [];
  for (const [parentId, childIds] of graph.children) {
    for (const childId of childIds) {
      edges.push({
        fromId: parentId,
        toId: childId,
        isActive: graph.activeEdges.has(edgeKey(parentId, childId)),
      });
    }
  }

  const maxX = nodes.reduce((max, n) => Math.max(max, n.x + GRAPH_NODE_WIDTH), 0);
  const maxY = nodes.reduce((max, n) => Math.max(max, n.y + GRAPH_NODE_HEIGHT), 0);

  return {
    nodes,
    edges,
    width: Math.max(tree.width, maxX) + GRAPH_H_GAP,
    height: maxY + GRAPH_V_GAP,
  };
}

export function messageNodeLabel(message: ChatMessage): string {
  const text = message.content.replace(/\s+/g, ' ').trim();
  if (!text) return message.role === 'user' ? 'User message' : 'Assistant message';
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** Active-path window size for the flowchart on long threads. */
export const FLOW_WINDOW_INITIAL = 40;
export const FLOW_WINDOW_EXPAND = 28;
export const FLOW_BRANCH_TAIL_CAP = 12;

/**
 * Slice a conversation for flowchart layout so mega-threads do not mount
 * thousands of SVG nodes. Keeps the active path window plus nearby branches.
 */
export function sliceConversationForFlow(
  conversation: Conversation,
  start: number,
  end: number,
): Conversation {
  const total = conversation.messages.length;
  if (total === 0) return conversation;

  const s = Math.max(0, Math.min(start, total));
  const e = Math.max(s, Math.min(end, total));
  const windowMessages = conversation.messages.slice(s, e);
  const idSet = new Set(windowMessages.map((m) => m.id));

  // Parent just outside the window — needed so branch edges still attach.
  const anchorParentId =
    s > 0 ? conversation.messages[s - 1]?.id : undefined;

  const branchPoints = (conversation.branchPoints ?? [])
    .filter((bp) => idSet.has(bp.parentMessageId) || bp.parentMessageId === anchorParentId)
    .map((bp) => ({
      ...bp,
      archived: (bp.archived ?? []).map((branch) => ({
        ...branch,
        tail: branch.tail.slice(0, FLOW_BRANCH_TAIL_CAP),
      })),
      liveTail: bp.liveTail ? bp.liveTail.slice(0, FLOW_BRANCH_TAIL_CAP) : bp.liveTail,
    }));

  return {
    ...conversation,
    messages: windowMessages,
    branchPoints,
  };
}

export function messageNodeTitle(message: ChatMessage): string {
  if (message.role === 'user') {
    return message.responderName ?? 'You';
  }
  return message.responderName ?? message.model ?? 'Assistant';
}