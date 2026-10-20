/**
 * Model-facing surface for Linked Notes (function tool + parse helpers).
 * UI and model share the same underlying NotesOp vocabulary.
 */

import type { MessageAugmentation } from './types.js';
import type { NoteNode, NotesOp, NotesOpResult, NotesScopeRef, NotesVault } from './notes-graph.js';
import { NOTES_TOOL_ID, NOTES_TOOL_KIND } from './notes-graph.js';

export const AETHER_NOTES_FUNCTION_NAME = 'aether_notes';

/** OpenAI/xAI Responses API function tool definition */
export const AETHER_NOTES_FUNCTION_TOOL = {
  type: 'function' as const,
  name: AETHER_NOTES_FUNCTION_NAME,
  description:
    'Linked notes (corkboard). Use proactively whenever the user refers to people, clues, places, prior case facts, or anything that might already be on the board — do not wait for them to say "search notes". ' +
    'Omit scope for reads/search to scan every vault you can access. Writes default to this chat when one is open. ' +
    'Create deliberate edges with create_edge (no [[wikilinks]]). Set visualize=true only when a card/subgraph helps; otherwise narrate softly.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create_node',
          'update_node',
          'delete_node',
          'create_edge',
          'update_edge',
          'delete_edge',
          'move_node',
          'promote_node',
          'list',
          'get_node',
          'search',
        ],
        description:
          'Operation. Prefer search (with a short query) over list when looking something up. Prefer get_node when you already have an id from context.',
      },
      scope: {
        type: 'string',
        enum: ['auto', 'root', 'conversation'],
        description:
          'Vault scope. Omit or "auto" for reads/search = all accessible vaults. Writes: omit = this chat if open, else root. Only set root/conversation when you intentionally target one vault.',
      },
      toScope: {
        type: 'string',
        enum: ['root', 'conversation'],
        description: 'Target scope for move_node',
      },
      moveMode: {
        type: 'string',
        enum: ['move', 'copy'],
        description: 'move_node mode. Default move.',
      },
      title: { type: 'string', description: 'Note title (create/update)' },
      body: { type: 'string', description: 'Note body markdown/plain text' },
      noteType: {
        type: 'string',
        description: 'Optional type tag: person, clue, place, event, question, etc.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags',
      },
      nodeId: { type: 'string', description: 'Target note id' },
      fromId: { type: 'string', description: 'Edge source note id' },
      toId: { type: 'string', description: 'Edge target note id' },
      edgeId: { type: 'string', description: 'Edge id for update/delete' },
      label: { type: 'string', description: 'Edge relationship label, e.g. "seen at"' },
      query: { type: 'string', description: 'Search query for title/body/tags' },
      reason: { type: 'string', description: 'Optional reason when deleting' },
      visualize: {
        type: 'boolean',
        description:
          'If true, attach a hard chat visualization (note card or subgraph). Use when showing structure helps; otherwise false/omit and narrate softly.',
      },
      view: {
        type: 'string',
        enum: ['node', 'subgraph', 'vault'],
        description: 'Hard visualization shape when visualize=true. Default node for single-note ops, vault for list.',
      },
    },
    required: ['action'],
  },
};

export type NotesScopeArg = 'auto' | 'root' | 'conversation';

export interface NotesFunctionArgs {
  action: string;
  scope?: NotesScopeArg;
  toScope?: 'root' | 'conversation';
  moveMode?: 'move' | 'copy';
  title?: string;
  body?: string;
  noteType?: string;
  tags?: string[];
  nodeId?: string;
  fromId?: string;
  toId?: string;
  edgeId?: string;
  label?: string;
  query?: string;
  reason?: string;
  visualize?: boolean;
  view?: 'node' | 'subgraph' | 'vault';
}

const READ_ACTIONS = new Set(['list', 'get_node', 'search']);

export function parseNotesFunctionArgs(raw: unknown): NotesFunctionArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid notes tool arguments');
  }
  const o = raw as Record<string, unknown>;
  const action = typeof o.action === 'string' ? o.action : '';
  if (!action) throw new Error('action is required');

  const scopeRaw = o.scope;
  const scope: NotesScopeArg | undefined =
    scopeRaw === 'root' || scopeRaw === 'conversation' || scopeRaw === 'auto'
      ? scopeRaw
      : undefined;

  return {
    action,
    scope,
    toScope: o.toScope === 'root' || o.toScope === 'conversation' ? o.toScope : undefined,
    moveMode: o.moveMode === 'copy' || o.moveMode === 'move' ? o.moveMode : undefined,
    title: typeof o.title === 'string' ? o.title : undefined,
    body: typeof o.body === 'string' ? o.body : undefined,
    noteType: typeof o.noteType === 'string' ? o.noteType : typeof o.type === 'string' ? o.type : undefined,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : undefined,
    nodeId: typeof o.nodeId === 'string' ? o.nodeId : undefined,
    fromId: typeof o.fromId === 'string' ? o.fromId : undefined,
    toId: typeof o.toId === 'string' ? o.toId : undefined,
    edgeId: typeof o.edgeId === 'string' ? o.edgeId : undefined,
    label: typeof o.label === 'string' ? o.label : undefined,
    query: typeof o.query === 'string' ? o.query : undefined,
    reason: typeof o.reason === 'string' ? o.reason : undefined,
    visualize: typeof o.visualize === 'boolean' ? o.visualize : undefined,
    view: o.view === 'node' || o.view === 'subgraph' || o.view === 'vault' ? o.view : undefined,
  };
}

/** Write default: chat vault when open, else root. Never "auto". */
export function resolveNotesWriteScope(
  args: Pick<NotesFunctionArgs, 'scope'>,
  conversationId?: string,
): NotesScopeRef {
  if (args.scope === 'root') return { kind: 'root' };
  if (args.scope === 'conversation') {
    if (!conversationId) throw new Error('conversation scope requires an active chat');
    return { kind: 'conversation', conversationId };
  }
  // auto / omit → chat-first for writes
  if (conversationId) return { kind: 'conversation', conversationId };
  return { kind: 'root' };
}

/** @deprecated use resolveNotesWriteScope — kept for call sites */
export function resolveNotesScopeFromArgs(
  args: NotesFunctionArgs,
  conversationId?: string,
): NotesScopeRef {
  return resolveNotesWriteScope(args, conversationId);
}

/** Whether this read should scan every accessible vault. */
export function isMultiScopeRead(args: NotesFunctionArgs): boolean {
  if (!READ_ACTIONS.has(args.action)) return false;
  return !args.scope || args.scope === 'auto';
}

export type NotesToolDispatch =
  | { kind: 'op'; op: NotesOp }
  | {
      kind: 'read';
      read: 'list' | 'get_node' | 'search';
      /** Single vault when pinned; multi when scopes is set */
      scope?: NotesScopeRef;
      multi?: boolean;
      nodeId?: string;
      query?: string;
    }
  | {
      kind: 'locate';
      /** Resolve nodeId across vaults then run mutate */
      action: 'update_node' | 'delete_node';
      nodeId: string;
      args: NotesFunctionArgs;
    };

export function notesArgsToDispatch(args: NotesFunctionArgs, conversationId?: string): NotesToolDispatch {
  switch (args.action) {
    case 'create_node': {
      if (!args.title?.trim()) throw new Error('title required for create_node');
      const scope = resolveNotesWriteScope(args, conversationId);
      return {
        kind: 'op',
        op: {
          op: 'createNode',
          scope,
          title: args.title,
          body: args.body,
          type: args.noteType,
          tags: args.tags,
        },
      };
    }
    case 'update_node':
      if (!args.nodeId) throw new Error('nodeId required for update_node');
      if (!args.scope || args.scope === 'auto') {
        return { kind: 'locate', action: 'update_node', nodeId: args.nodeId, args };
      }
      return {
        kind: 'op',
        op: {
          op: 'updateNode',
          scope: resolveNotesWriteScope(args, conversationId),
          nodeId: args.nodeId,
          title: args.title,
          body: args.body,
          type: args.noteType === undefined ? undefined : args.noteType || null,
          tags: args.tags,
        },
      };
    case 'delete_node':
      if (!args.nodeId) throw new Error('nodeId required for delete_node');
      if (!args.scope || args.scope === 'auto') {
        return { kind: 'locate', action: 'delete_node', nodeId: args.nodeId, args };
      }
      return {
        kind: 'op',
        op: {
          op: 'deleteNode',
          scope: resolveNotesWriteScope(args, conversationId),
          nodeId: args.nodeId,
          reason: args.reason,
        },
      };
    case 'create_edge': {
      if (!args.fromId || !args.toId) throw new Error('fromId and toId required for create_edge');
      const scope = resolveNotesWriteScope(args, conversationId);
      return {
        kind: 'op',
        op: {
          op: 'createEdge',
          scope,
          fromId: args.fromId,
          toId: args.toId,
          label: args.label,
        },
      };
    }
    case 'update_edge': {
      if (!args.edgeId) throw new Error('edgeId required for update_edge');
      const scope = resolveNotesWriteScope(args, conversationId);
      return {
        kind: 'op',
        op: {
          op: 'updateEdge',
          scope,
          edgeId: args.edgeId,
          label: args.label === undefined ? undefined : args.label || null,
        },
      };
    }
    case 'delete_edge': {
      if (!args.edgeId) throw new Error('edgeId required for delete_edge');
      const scope = resolveNotesWriteScope(args, conversationId);
      return {
        kind: 'op',
        op: {
          op: 'deleteEdge',
          scope,
          edgeId: args.edgeId,
          reason: args.reason,
        },
      };
    }
    case 'move_node': {
      if (!args.nodeId) throw new Error('nodeId required for move_node');
      // From: explicit or conversation-first
      const from =
        args.scope === 'root' || args.scope === 'conversation'
          ? resolveNotesWriteScope(args, conversationId)
          : conversationId
            ? { kind: 'conversation' as const, conversationId }
            : { kind: 'root' as const };
      const toKind = args.toScope ?? (from.kind === 'root' ? 'conversation' : 'root');
      if (toKind === 'conversation' && !conversationId) {
        throw new Error('move_node to conversation requires an active chat');
      }
      const to: NotesScopeRef =
        toKind === 'root'
          ? { kind: 'root' }
          : { kind: 'conversation', conversationId };
      return {
        kind: 'op',
        op: {
          op: 'moveNode',
          from,
          to,
          nodeId: args.nodeId,
          mode: args.moveMode ?? 'move',
        },
      };
    }
    case 'promote_node':
      if (!args.nodeId) throw new Error('nodeId required for promote_node');
      if (!conversationId) throw new Error('promote_node requires an active conversation');
      return {
        kind: 'op',
        op: {
          op: 'promoteNode',
          conversationId,
          nodeId: args.nodeId,
        },
      };
    case 'list':
      if (isMultiScopeRead(args)) {
        return { kind: 'read', read: 'list', multi: true };
      }
      return {
        kind: 'read',
        read: 'list',
        scope: resolveNotesWriteScope(args, conversationId),
      };
    case 'get_node':
      if (!args.nodeId) throw new Error('nodeId required for get_node');
      if (isMultiScopeRead(args)) {
        return { kind: 'read', read: 'get_node', multi: true, nodeId: args.nodeId };
      }
      return {
        kind: 'read',
        read: 'get_node',
        scope: resolveNotesWriteScope(args, conversationId),
        nodeId: args.nodeId,
      };
    case 'search':
      if (!args.query?.trim()) throw new Error('query required for search');
      if (isMultiScopeRead(args)) {
        return { kind: 'read', read: 'search', multi: true, query: args.query };
      }
      return {
        kind: 'read',
        read: 'search',
        scope: resolveNotesWriteScope(args, conversationId),
        query: args.query,
      };
    default:
      throw new Error(`Unknown notes action: ${args.action}`);
  }
}

export function narrateNotesAction(args: NotesFunctionArgs, phase: 'start' | 'done', detail?: string): string {
  const scopeLabel = args.scope === 'root' ? 'root library' : args.scope === 'conversation' ? 'this chat' : 'notes';
  const title = args.title ? `“${args.title}”` : args.nodeId ? `note ${args.nodeId.slice(0, 8)}…` : null;

  const startMap: Record<string, string> = {
    create_node: `Adding note ${title ?? ''} to ${scopeLabel}…`.replace(/\s+/g, ' ').trim(),
    update_node: `Updating ${title ?? 'a note'} in ${scopeLabel}…`,
    delete_node: `Trashing ${title ?? 'a note'} from ${scopeLabel}…`,
    create_edge: `Linking notes in ${scopeLabel}${args.label ? ` (${args.label})` : ''}…`,
    update_edge: `Updating a link in ${scopeLabel}…`,
    delete_edge: `Removing a link in ${scopeLabel}…`,
    move_node: `Moving ${title ?? 'a note'} between scopes…`,
    promote_node: `Promoting ${title ?? 'a note'} to the root library…`,
    list: `Listing notes in ${scopeLabel}…`,
    get_node: `Reading ${title ?? 'a note'}…`,
    search: `Searching notes for “${args.query ?? ''}”…`,
  };

  const doneMap: Record<string, string> = {
    create_node: `Added note ${title ?? ''}`.trim(),
    update_node: `Updated ${title ?? 'note'}`,
    delete_node: `Moved ${title ?? 'note'} to trash`,
    create_edge: args.label ? `Linked notes (${args.label})` : 'Linked notes',
    update_edge: 'Updated link',
    delete_edge: 'Removed link',
    move_node: args.moveMode === 'copy' ? `Copied ${title ?? 'note'} across scopes` : `Moved ${title ?? 'note'} across scopes`,
    promote_node: `Promoted ${title ?? 'note'} to root`,
    list: detail ?? 'Listed notes',
    get_node: detail ?? 'Read note',
    search: detail ?? 'Search complete',
  };

  return phase === 'start'
    ? startMap[args.action] ?? `Running notes ${args.action}…`
    : doneMap[args.action] ?? `Notes ${args.action} done`;
}

export function summarizeVaultForModel(vault: NotesVault, limit = 40): {
  scope: NotesScopeRef;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{ id: string; title: string; type?: string; tags?: string[]; bodyPreview: string }>;
  edges: Array<{ id: string; fromId: string; toId: string; label?: string }>;
} {
  return {
    scope: vault.scope,
    nodeCount: vault.nodes.length,
    edgeCount: vault.edges.length,
    nodes: vault.nodes.slice(0, limit).map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      tags: n.tags,
      bodyPreview: n.body.slice(0, 160),
    })),
    edges: vault.edges.slice(0, limit).map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      label: e.label,
    })),
  };
}

export interface RankedNoteHit {
  node: NoteNode;
  scope: NotesScopeRef;
  score: number;
}

/** Token-ish ranked search; title/type beats body. */
export function searchNotesVault(vault: NotesVault, query: string): NoteNode[] {
  return rankNotesSearch([{ vault, scope: vault.scope }], query).map((h) => h.node);
}

export function rankNotesSearch(
  sources: Array<{ vault: NotesVault; scope: NotesScopeRef }>,
  query: string,
  limit = 30,
): RankedNoteHit[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const tokens = raw.split(/[\s,;/|]+/).filter((t) => t.length > 1);
  const terms = tokens.length > 0 ? tokens : [raw];

  const hits: RankedNoteHit[] = [];
  for (const { vault, scope } of sources) {
    for (const node of vault.nodes) {
      const title = node.title.toLowerCase();
      const type = (node.type ?? '').toLowerCase();
      const tags = (node.tags ?? []).join(' ').toLowerCase();
      const body = node.body.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title === term) score += 100;
        else if (title.includes(term)) score += 40;
        if (type === term || type.includes(term)) score += 25;
        if (tags.includes(term)) score += 15;
        if (body.includes(term)) score += 8;
      }
      // Full phrase bonus
      if (title.includes(raw)) score += 20;
      if (body.includes(raw)) score += 5;
      if (score > 0) hits.push({ node, scope, score });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
  return hits.slice(0, limit);
}

export function formatNotesAmbientSnapshot(opts: {
  access: string;
  conversationId?: string;
  chat?: NotesVault | null;
  root?: NotesVault | null;
  maxNodes?: number;
}): string {
  const max = opts.maxNodes ?? 24;
  const lines: string[] = ['### Notes already on the board (live snapshot)'];

  const renderVault = (label: string, vault: NotesVault | null | undefined) => {
    if (!vault) {
      lines.push(`**${label}**: (unavailable)`);
      return;
    }
    if (vault.nodes.length === 0) {
      lines.push(`**${label}**: empty`);
      return;
    }
    lines.push(
      `**${label}**: ${vault.nodes.length} notes, ${vault.edges.length} links`,
    );
    const slice = vault.nodes.slice(0, max);
    for (const n of slice) {
      const type = n.type ? ` [${n.type}]` : '';
      const preview = n.body.trim()
        ? ` — ${n.body.trim().replace(/\s+/g, ' ').slice(0, 80)}`
        : '';
      lines.push(`- \`${n.id.slice(0, 8)}\` **${n.title}**${type}${preview}`);
    }
    if (vault.nodes.length > max) {
      lines.push(`- …and ${vault.nodes.length - max} more (use search)`);
    }
    // Compact edge map for small boards
    if (vault.edges.length > 0 && vault.edges.length <= 20) {
      const titleById = new Map(vault.nodes.map((n) => [n.id, n.title]));
      for (const e of vault.edges.slice(0, 16)) {
        const from = titleById.get(e.fromId) ?? e.fromId.slice(0, 8);
        const to = titleById.get(e.toId) ?? e.toId.slice(0, 8);
        lines.push(`  · ${from} ${e.label ? `—( ${e.label} )→` : '→'} ${to}`);
      }
    }
  };

  if (opts.access === 'all') {
    renderVault('This chat', opts.chat ?? null);
    renderVault('Root library', opts.root ?? null);
  } else if (opts.access === 'conversation') {
    renderVault('This chat', opts.chat ?? null);
  } else {
    lines.push('(Notes disabled for the model in this context.)');
  }

  lines.push(
    'Use ids from this snapshot with get_node / update_node / create_edge. If something might be here but is not listed, call search (omit scope).',
  );
  return lines.join('\n');
}

export function buildNotesAugmentation(
  args: NotesFunctionArgs,
  result: NotesOpResult & { vault?: NotesVault; node?: NoteNode },
  conversationId?: string,
): MessageAugmentation | null {
  if (!args.visualize) return null;

  const scope = result.vault?.scope
    ?? (args.scope === 'root'
      ? { kind: 'root' as const }
      : conversationId
        ? { kind: 'conversation' as const, conversationId }
        : { kind: 'root' as const });

  const view =
    args.view
    ?? (args.action === 'list' || args.action === 'search' ? 'vault' : 'node');

  let payload: Record<string, unknown>;

  if (view === 'vault') {
    payload = {
      view: 'vault',
      scope,
      nodeIds: (result.vault?.nodes ?? []).slice(0, 24).map((n) => n.id),
      preview: summarizeVaultForModel(result.vault ?? { scope, nodes: [], edges: [], updatedAt: '' }, 12),
    };
  } else if (view === 'subgraph' && result.node && result.vault) {
    const id = result.node.id;
    const edgeIds = result.vault.edges
      .filter((e) => e.fromId === id || e.toId === id)
      .map((e) => e.id);
    const neighborIds = new Set<string>([id]);
    for (const e of result.vault.edges) {
      if (e.fromId === id) neighborIds.add(e.toId);
      if (e.toId === id) neighborIds.add(e.fromId);
    }
    payload = {
      view: 'subgraph',
      scope,
      nodeIds: [...neighborIds],
      edgeIds,
      focusNodeId: id,
      nodes: result.vault.nodes.filter((n) => neighborIds.has(n.id)).map((n) => ({
        id: n.id,
        title: n.title,
        type: n.type,
        bodyPreview: n.body.slice(0, 120),
      })),
      edges: result.vault.edges
        .filter((e) => edgeIds.includes(e.id))
        .map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId, label: e.label })),
    };
  } else {
    const node = result.node ?? result.vault?.nodes.find((n) => n.id === args.nodeId);
    if (!node) return null;
    payload = {
      view: 'node',
      scope,
      nodeId: node.id,
      title: node.title,
      type: node.type,
      bodyPreview: node.body.slice(0, 280),
      tags: node.tags,
    };
  }

  return {
    id: `aug-notes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    toolId: NOTES_TOOL_ID,
    kind: NOTES_TOOL_KIND,
    payload,
  };
}

export function buildNotesSystemPromptSection(opts: {
  access: string;
  allowPromoteToRoot: boolean;
  allowMoveFromRoot?: boolean;
  conversationId?: string;
  /** Pre-formatted ambient vault snapshot */
  ambientSnapshot?: string;
}): string {
  const lines = [
    '## Linked Notes',
    'You have `aether_notes` — a shared corkboard with the user. Treat it as memory for this case and the root library.',
    '',
    '### Be fluid (important)',
    '- **Proactively** use notes when the user mentions names, places, clues, theories, or "what do we know about…". Do **not** wait for "search the notes" or a scope name.',
    '- A live snapshot of accessible notes is below. Prefer it first; call `search` (omit scope) only if you need a fuller lookup or the snapshot is incomplete.',
    '- **Reads/search**: omit `scope` (auto) — scans every vault you can access. Do not ask the user which scope unless they care.',
    '- **Writes** (create/update/link): omit `scope` to default to **this chat** when open; use `scope: "root"` only for durable library items.',
    '- When the user says "remember", "pin", "add to the board", or states a lasting fact in an investigation — create/update notes without asking permission.',
    '- Link related notes with `create_edge` when a relationship is clear. No [[wikilink]] syntax.',
    '- Soft-cite in prose by default; `visualize: true` when a card or subgraph would help.',
    '',
    '### Policy',
    opts.allowPromoteToRoot
      ? '- You may move chat notes → root when graduating durable knowledge.'
      : '- Moving notes to the root library is disabled for you here.',
    opts.allowMoveFromRoot
      ? '- You may move root notes → this chat when pulling library items into the case.'
      : '- Moving root → chat is disabled for you (user can still do it in the UI).',
    `- Model access: **${opts.access}**.`,
    opts.conversationId
      ? `- Active chat id: \`${opts.conversationId}\`.`
      : '- No active chat — writes go to root.',
    '- Users always have full UI access in Tools & Automation → Linked Notes.',
  ];

  if (opts.ambientSnapshot) {
    lines.push('', opts.ambientSnapshot);
  }

  return lines.join('\n');
}
