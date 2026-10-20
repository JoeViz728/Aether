/**
 * Linked-notes graph tool (Obsidian-like, deliberate edges only).
 *
 * Design locks:
 * - Explicit edges (no wikilink auto-parse)
 * - Hybrid scope: root library + per-conversation case files
 * - User may freely move notes either direction; model moves gated by policy
 * - Soft deletes go to trash
 * - Model access: app defaults → story/persona → conversation override
 */

export const NOTES_TOOL_ID = 'builtin:notes-graph';
export const NOTES_TOOL_KIND = 'notes-graph';

/** Where a note/edge lives */
export type NotesScopeKind = 'root' | 'conversation';

export interface NotesScopeRef {
  kind: NotesScopeKind;
  /** Required when kind === 'conversation' */
  conversationId?: string;
}

/**
 * Access level for resource-backed tools (notes, and future vaults).
 * Controls what the *model* may read/write. Users always have full UI access.
 */
export type ToolResourceAccess = 'all' | 'conversation' | 'none';

export interface ToolScopeConfig {
  access: ToolResourceAccess;
  /**
   * Model may move notes conversation → root.
   * @deprecated prefer allowMoveToRoot — still read for older data
   */
  allowPromoteToRoot?: boolean;
  /** Model may move notes conversation → root. Default true when omitted. */
  allowMoveToRoot?: boolean;
  /** Model may move notes root → conversation. Default false when omitted. */
  allowMoveFromRoot?: boolean;
}

/**
 * Server-wide defaults for how notes access is derived when a conversation
 * has not set an explicit override.
 */
export interface NotesScopeDefaults {
  /** Bare model (no persona, not story mode). Default: all */
  bareModel: ToolScopeConfig;
  /** Active persona without its own toolScopes override. Default: conversation */
  withPersona: ToolScopeConfig;
  /** Story mode on (unless conversation overrides). Default: conversation */
  storyMode: ToolScopeConfig;
}

export const DEFAULT_NOTES_SCOPE_DEFAULTS: NotesScopeDefaults = {
  bareModel: {
    access: 'all',
    allowMoveToRoot: true,
    allowMoveFromRoot: false,
  },
  withPersona: {
    access: 'conversation',
    allowMoveToRoot: true,
    allowMoveFromRoot: false,
  },
  storyMode: {
    access: 'conversation',
    allowMoveToRoot: true,
    allowMoveFromRoot: false,
  },
};

/** Default bare-model config (compat alias). */
export const DEFAULT_BARE_NOTES_SCOPE: ToolScopeConfig = DEFAULT_NOTES_SCOPE_DEFAULTS.bareModel;

export type NotesScopeSource =
  | 'conversation'
  | 'persona'
  | 'storyMode'
  | 'withPersona'
  | 'bareModel';

export interface ResolvedNotesScope {
  config: ToolScopeConfig;
  /** Which layer produced the effective config */
  source: NotesScopeSource;
  /** True when conversation.settings.toolScopes explicitly set notes */
  conversationOverride: boolean;
}

export interface NoteNode {
  id: string;
  title: string;
  body: string;
  /** Optional freeform type, e.g. person | clue | place | question */
  type?: string;
  tags?: string[];
  /** Cached layout position in the graph view (not authoritative structure) */
  x?: number;
  y?: number;
  createdAt: string;
  updatedAt: string;
}

/** Deliberate link between two notes — never inferred from prose. */
export interface NoteEdge {
  id: string;
  fromId: string;
  toId: string;
  /** Relationship label, e.g. "seen at", "alibi for" */
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotesVault {
  scope: NotesScopeRef;
  nodes: NoteNode[];
  edges: NoteEdge[];
  updatedAt: string;
}

export type NotesTrashEntityType = 'node' | 'edge';

export interface NotesTrashItem {
  id: string;
  entityType: NotesTrashEntityType;
  /** Scope the entity came from (restore returns it here) */
  scope: NotesScopeRef;
  /** Serialized NoteNode or NoteEdge */
  entity: NoteNode | NoteEdge;
  deletedAt: string;
  /** Optional human/model reason */
  reason?: string;
}

/** Structured ops for user UI and model commands */
export type NotesOp =
  | { op: 'createNode'; scope: NotesScopeRef; title: string; body?: string; type?: string; tags?: string[]; x?: number; y?: number }
  | { op: 'updateNode'; scope: NotesScopeRef; nodeId: string; title?: string; body?: string; type?: string | null; tags?: string[]; x?: number; y?: number }
  | { op: 'deleteNode'; scope: NotesScopeRef; nodeId: string; reason?: string }
  | { op: 'createEdge'; scope: NotesScopeRef; fromId: string; toId: string; label?: string }
  | { op: 'updateEdge'; scope: NotesScopeRef; edgeId: string; label?: string | null }
  | { op: 'deleteEdge'; scope: NotesScopeRef; edgeId: string; reason?: string }
  | {
      op: 'moveNode';
      from: NotesScopeRef;
      to: NotesScopeRef;
      nodeId: string;
      /** move = relocate; copy = duplicate into target (new ids for copy's edges only when both ends copied — single node copy has no edges) */
      mode?: 'move' | 'copy';
    }
  /** @deprecated use moveNode to root — still supported */
  | { op: 'promoteNode'; conversationId: string; nodeId: string; includeInternalEdges?: boolean }
  | { op: 'setLayout'; scope: NotesScopeRef; positions: Array<{ nodeId: string; x: number; y: number }> };

export interface NotesOpResult {
  ok: boolean;
  error?: string;
  vault?: NotesVault;
  /** Present after cross-scope moves */
  rootVault?: NotesVault;
  conversationVault?: NotesVault;
  trashItem?: NotesTrashItem;
  node?: NoteNode;
  edge?: NoteEdge;
}

/** Hard chat augmentation payload (model opts in when visualization helps). */
export type NotesAugmentationPayload =
  | { view: 'node'; scope: NotesScopeRef; nodeId: string }
  | { view: 'subgraph'; scope: NotesScopeRef; nodeIds: string[]; edgeIds?: string[] }
  | { view: 'vault'; scope: NotesScopeRef };

export function emptyVault(scope: NotesScopeRef): NotesVault {
  return {
    scope,
    nodes: [],
    edges: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeToolScopeConfig(raw?: ToolScopeConfig | null): ToolScopeConfig | null {
  if (!raw || !raw.access) return null;
  if (raw.access !== 'all' && raw.access !== 'conversation' && raw.access !== 'none') return null;
  const allowMoveToRoot = raw.allowMoveToRoot ?? raw.allowPromoteToRoot ?? true;
  const allowMoveFromRoot = raw.allowMoveFromRoot ?? false;
  return {
    access: raw.access,
    allowMoveToRoot,
    allowMoveFromRoot,
    allowPromoteToRoot: allowMoveToRoot,
  };
}

export function mergeNotesScopeDefaults(
  partial?: Partial<NotesScopeDefaults> | null,
): NotesScopeDefaults {
  const base = DEFAULT_NOTES_SCOPE_DEFAULTS;
  return {
    bareModel: normalizeToolScopeConfig(partial?.bareModel) ?? { ...base.bareModel },
    withPersona: normalizeToolScopeConfig(partial?.withPersona) ?? { ...base.withPersona },
    storyMode: normalizeToolScopeConfig(partial?.storyMode) ?? { ...base.storyMode },
  };
}

/**
 * Resolve model notes access.
 * Conversation explicit override wins; else story mode; else persona (or withPersona default); else bare.
 */
export function resolveNotesScopeConfig(opts: {
  appDefaults?: Partial<NotesScopeDefaults> | null;
  storyMode?: boolean;
  hasPersona?: boolean;
  personaConfig?: ToolScopeConfig | null;
  conversationConfig?: ToolScopeConfig | null;
}): ResolvedNotesScope {
  const defaults = mergeNotesScopeDefaults(opts.appDefaults);
  const convo = normalizeToolScopeConfig(opts.conversationConfig);
  if (convo) {
    return { config: convo, source: 'conversation', conversationOverride: true };
  }

  if (opts.storyMode) {
    return {
      config: normalizeToolScopeConfig(defaults.storyMode) ?? defaults.storyMode,
      source: 'storyMode',
      conversationOverride: false,
    };
  }

  if (opts.hasPersona) {
    const persona = normalizeToolScopeConfig(opts.personaConfig);
    if (persona) {
      return { config: persona, source: 'persona', conversationOverride: false };
    }
    return {
      config: normalizeToolScopeConfig(defaults.withPersona) ?? defaults.withPersona,
      source: 'withPersona',
      conversationOverride: false,
    };
  }

  return {
    config: normalizeToolScopeConfig(defaults.bareModel) ?? defaults.bareModel,
    source: 'bareModel',
    conversationOverride: false,
  };
}

/** Whether the model may read/write the given vault scope under effective config. */
export function canAccessNotesScope(
  config: ToolScopeConfig,
  scope: NotesScopeRef,
): boolean {
  if (config.access === 'none') return false;
  if (config.access === 'all') return true;
  return scope.kind === 'conversation';
}

export function modelMayMoveNotes(
  config: ToolScopeConfig,
  from: NotesScopeRef,
  to: NotesScopeRef,
): boolean {
  if (from.kind === to.kind && from.conversationId === to.conversationId) return false;
  // Must be able to touch both ends for a move
  if (!canAccessNotesScope(config, from) || !canAccessNotesScope(config, to)) {
    // Allow promote path when access is conversation-only: can leave convo toward root if allowMoveToRoot
    if (
      from.kind === 'conversation' &&
      to.kind === 'root' &&
      config.access === 'conversation' &&
      (config.allowMoveToRoot ?? config.allowPromoteToRoot ?? true)
    ) {
      return true;
    }
    return false;
  }
  if (from.kind === 'conversation' && to.kind === 'root') {
    return config.allowMoveToRoot ?? config.allowPromoteToRoot ?? true;
  }
  if (from.kind === 'root' && to.kind === 'conversation') {
    return config.allowMoveFromRoot ?? false;
  }
  return false;
}

export const NOTES_ACCESS_LABELS: Record<ToolResourceAccess, string> = {
  all: 'Root library + chat notes',
  conversation: 'This chat only',
  none: 'Disabled',
};

export const NOTES_SCOPE_SOURCE_LABELS: Record<NotesScopeSource, string> = {
  conversation: 'Conversation override',
  persona: 'Persona setting',
  storyMode: 'Story mode default',
  withPersona: 'Persona default (app)',
  bareModel: 'Bare model default (app)',
};
