import { v4 as uuid } from 'uuid';
import type {
  NoteEdge,
  NoteNode,
  NotesOp,
  NotesOpResult,
  NotesScopeRef,
  NotesTrashItem,
  NotesVault,
  ResolvedNotesScope,
  ToolScopeConfig,
} from '@aether/shared';
import {
  NOTES_TOOL_ID,
  canAccessNotesScope,
  modelMayMoveNotes,
  normalizeToolScopeConfig,
  resolveNotesScopeConfig,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';

function nowIso(): string {
  return new Date().toISOString();
}

function scopeKey(scope: NotesScopeRef): string {
  if (scope.kind === 'root') return 'root';
  if (!scope.conversationId) throw new Error('conversation scope requires conversationId');
  return `conversation:${scope.conversationId}`;
}

function assertScope(scope: NotesScopeRef): NotesScopeRef {
  if (scope.kind === 'conversation' && !scope.conversationId) {
    throw new Error('conversation scope requires conversationId');
  }
  return scope.kind === 'root'
    ? { kind: 'root' }
    : { kind: 'conversation', conversationId: scope.conversationId };
}

function scopesEqual(a: NotesScopeRef, b: NotesScopeRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'root') return true;
  return a.conversationId === b.conversationId;
}

/** Full access for human UI — model policy does not apply. */
const USER_FULL_ACCESS: ToolScopeConfig = {
  access: 'all',
  allowMoveToRoot: true,
  allowMoveFromRoot: true,
  allowPromoteToRoot: true,
};

export class NotesService {
  constructor(private store: DataStore) {}

  async getVault(scope: NotesScopeRef): Promise<NotesVault> {
    const normalized = assertScope(scope);
    return this.store.readNotesVault(normalized);
  }

  async listTrash(): Promise<NotesTrashItem[]> {
    return this.store.listNotesTrash();
  }

  async resolveEffectiveScope(opts: {
    conversationId?: string;
    personaId?: string;
  }): Promise<ResolvedNotesScope> {
    const settings = await this.store.getSettings();
    let personaConfig: ToolScopeConfig | null = null;
    let conversationConfig: ToolScopeConfig | null = null;
    let storyMode = false;
    let hasPersona = false;
    let activePersonaId = opts.personaId;

    if (opts.conversationId) {
      const convo = await this.store.getConversation(opts.conversationId);
      conversationConfig = convo?.settings?.toolScopes?.[NOTES_TOOL_ID] ?? null;
      storyMode = Boolean(convo?.settings?.storyMode);
      if (!activePersonaId && convo?.activePersonaId) {
        activePersonaId = convo.activePersonaId;
      }
    }

    if (activePersonaId) {
      hasPersona = true;
      const personas = await this.store.listPersonas();
      const persona = personas.find((p) => p.id === activePersonaId);
      personaConfig = persona?.toolScopes?.[NOTES_TOOL_ID] ?? null;
    }

    return resolveNotesScopeConfig({
      appDefaults: settings.notesScopeDefaults,
      storyMode,
      hasPersona,
      personaConfig,
      conversationConfig,
    });
  }

  /** Convenience: just the config (model path). */
  async resolveEffectiveConfig(opts: {
    conversationId?: string;
    personaId?: string;
  }): Promise<ToolScopeConfig> {
    const resolved = await this.resolveEffectiveScope(opts);
    return resolved.config;
  }

  async applyOp(
    op: NotesOp,
    context?: {
      conversationId?: string;
      personaId?: string;
      /** user = full access (UI); model = enforce policy. Default model. */
      actor?: 'user' | 'model';
      skipScopeCheck?: boolean;
    },
  ): Promise<NotesOpResult> {
    try {
      const actor = context?.actor ?? (context?.skipScopeCheck ? 'user' : 'model');
      const effective =
        actor === 'user' || context?.skipScopeCheck
          ? USER_FULL_ACCESS
          : (await this.resolveEffectiveScope({
              conversationId: context?.conversationId ?? this.conversationIdFromOp(op),
              personaId: context?.personaId,
            })).config;

      switch (op.op) {
        case 'createNode':
          return await this.createNode(op, effective);
        case 'updateNode':
          return await this.updateNode(op, effective);
        case 'deleteNode':
          return await this.deleteNode(op, effective);
        case 'createEdge':
          return await this.createEdge(op, effective);
        case 'updateEdge':
          return await this.updateEdge(op, effective);
        case 'deleteEdge':
          return await this.deleteEdge(op, effective);
        case 'moveNode':
          return await this.moveNode(op, effective, actor);
        case 'promoteNode':
          return await this.moveNode(
            {
              op: 'moveNode',
              from: { kind: 'conversation', conversationId: op.conversationId },
              to: { kind: 'root' },
              nodeId: op.nodeId,
              mode: 'move',
            },
            effective,
            actor,
          );
        case 'setLayout':
          return await this.setLayout(op, effective);
        default:
          return { ok: false, error: 'Unknown op' };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async restoreTrashItem(trashId: string): Promise<NotesOpResult> {
    const trash = await this.store.listNotesTrash();
    const item = trash.find((t) => t.id === trashId);
    if (!item) return { ok: false, error: 'Trash item not found' };

    const vault = await this.store.readNotesVault(item.scope);
    const t = nowIso();

    if (item.entityType === 'node') {
      const node = item.entity as NoteNode;
      if (vault.nodes.some((n) => n.id === node.id)) {
        return { ok: false, error: 'A node with this id already exists in the vault' };
      }
      vault.nodes.push(node);
    } else {
      const edge = item.entity as NoteEdge;
      if (vault.edges.some((e) => e.id === edge.id)) {
        return { ok: false, error: 'An edge with this id already exists in the vault' };
      }
      const nodeIds = new Set(vault.nodes.map((n) => n.id));
      if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) {
        return { ok: false, error: 'Cannot restore edge: endpoint notes missing (restore nodes first)' };
      }
      vault.edges.push(edge);
    }

    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    await this.store.removeNotesTrashItem(trashId);
    return { ok: true, vault, trashItem: item };
  }

  async emptyTrash(): Promise<{ removed: number }> {
    return this.store.emptyNotesTrash();
  }

  private conversationIdFromOp(op: NotesOp): string | undefined {
    if (op.op === 'promoteNode') return op.conversationId;
    if (op.op === 'moveNode') {
      if (op.from.kind === 'conversation') return op.from.conversationId;
      if (op.to.kind === 'conversation') return op.to.conversationId;
    }
    if ('scope' in op && op.scope.kind === 'conversation') return op.scope.conversationId;
    return undefined;
  }

  private deny(scope: NotesScopeRef): NotesOpResult {
    return { ok: false, error: `Access denied for scope ${scopeKey(scope)}` };
  }

  private async createNode(
    op: Extract<NotesOp, { op: 'createNode' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const t = nowIso();
    const node: NoteNode = {
      id: uuid(),
      title: op.title.trim() || 'Untitled',
      body: op.body ?? '',
      type: op.type,
      tags: op.tags,
      x: op.x,
      y: op.y,
      createdAt: t,
      updatedAt: t,
    };

    const vault = await this.store.readNotesVault(scope);
    vault.nodes.push(node);
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    return { ok: true, vault, node };
  }

  private async updateNode(
    op: Extract<NotesOp, { op: 'updateNode' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const node = vault.nodes.find((n) => n.id === op.nodeId);
    if (!node) return { ok: false, error: 'Node not found' };

    const t = nowIso();
    if (op.title !== undefined) node.title = op.title.trim() || node.title;
    if (op.body !== undefined) node.body = op.body;
    if (op.type !== undefined) node.type = op.type === null ? undefined : op.type;
    if (op.tags !== undefined) node.tags = op.tags;
    if (op.x !== undefined) node.x = op.x;
    if (op.y !== undefined) node.y = op.y;
    node.updatedAt = t;
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    return { ok: true, vault, node };
  }

  private async deleteNode(
    op: Extract<NotesOp, { op: 'deleteNode' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const idx = vault.nodes.findIndex((n) => n.id === op.nodeId);
    if (idx < 0) return { ok: false, error: 'Node not found' };

    const [node] = vault.nodes.splice(idx, 1);
    const t = nowIso();

    const detachedEdges = vault.edges.filter((e) => e.fromId === node.id || e.toId === node.id);
    vault.edges = vault.edges.filter((e) => e.fromId !== node.id && e.toId !== node.id);
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);

    const trashItem = await this.store.addNotesTrashItem({
      id: uuid(),
      entityType: 'node',
      scope,
      entity: node,
      deletedAt: t,
      reason: op.reason,
    });

    for (const edge of detachedEdges) {
      await this.store.addNotesTrashItem({
        id: uuid(),
        entityType: 'edge',
        scope,
        entity: edge,
        deletedAt: t,
        reason: op.reason ? `${op.reason} (edge with node)` : 'edge removed with node',
      });
    }

    return { ok: true, vault, trashItem, node };
  }

  private async createEdge(
    op: Extract<NotesOp, { op: 'createEdge' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const nodeIds = new Set(vault.nodes.map((n) => n.id));
    if (!nodeIds.has(op.fromId) || !nodeIds.has(op.toId)) {
      return { ok: false, error: 'Both endpoint notes must exist in this scope' };
    }
    if (op.fromId === op.toId) {
      return { ok: false, error: 'Cannot link a note to itself' };
    }

    const t = nowIso();
    const edge: NoteEdge = {
      id: uuid(),
      fromId: op.fromId,
      toId: op.toId,
      label: op.label?.trim() || undefined,
      createdAt: t,
      updatedAt: t,
    };
    vault.edges.push(edge);
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    return { ok: true, vault, edge };
  }

  private async updateEdge(
    op: Extract<NotesOp, { op: 'updateEdge' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const edge = vault.edges.find((e) => e.id === op.edgeId);
    if (!edge) return { ok: false, error: 'Edge not found' };

    const t = nowIso();
    if (op.label !== undefined) edge.label = op.label === null ? undefined : op.label.trim() || undefined;
    edge.updatedAt = t;
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    return { ok: true, vault, edge };
  }

  private async deleteEdge(
    op: Extract<NotesOp, { op: 'deleteEdge' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const idx = vault.edges.findIndex((e) => e.id === op.edgeId);
    if (idx < 0) return { ok: false, error: 'Edge not found' };

    const [edge] = vault.edges.splice(idx, 1);
    const t = nowIso();
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);

    const trashItem = await this.store.addNotesTrashItem({
      id: uuid(),
      entityType: 'edge',
      scope,
      entity: edge,
      deletedAt: t,
      reason: op.reason,
    });

    return { ok: true, vault, trashItem, edge };
  }

  /**
   * Move or copy a note between root and conversation scopes.
   * Users always can; model gated by allowMoveToRoot / allowMoveFromRoot.
   */
  private async moveNode(
    op: Extract<NotesOp, { op: 'moveNode' }>,
    effective: ToolScopeConfig,
    actor: 'user' | 'model',
  ): Promise<NotesOpResult> {
    const from = assertScope(op.from);
    const to = assertScope(op.to);
    if (scopesEqual(from, to)) {
      return { ok: false, error: 'Source and target scope are the same' };
    }

    if (actor === 'model' && !modelMayMoveNotes(effective, from, to)) {
      return {
        ok: false,
        error: `Model is not allowed to move notes from ${scopeKey(from)} to ${scopeKey(to)}`,
      };
    }

    const mode = op.mode ?? 'move';
    const fromVault = await this.store.readNotesVault(from);
    const toVault = await this.store.readNotesVault(to);
    const nodeIdx = fromVault.nodes.findIndex((n) => n.id === op.nodeId);
    if (nodeIdx < 0) return { ok: false, error: 'Node not found in source scope' };

    const sourceNode = fromVault.nodes[nodeIdx];
    const t = nowIso();

    let node: NoteNode;
    if (mode === 'copy') {
      node = {
        ...sourceNode,
        id: uuid(),
        createdAt: t,
        updatedAt: t,
      };
    } else {
      [node] = fromVault.nodes.splice(nodeIdx, 1);
      node.updatedAt = t;
    }

    if (toVault.nodes.some((n) => n.id === node.id)) {
      if (mode === 'move') fromVault.nodes.push(sourceNode);
      return { ok: false, error: 'A note with this id already exists in the target scope' };
    }

    toVault.nodes.push(node);

    // Move: relocate edges that can fully live in the target; otherwise trash
    if (mode === 'move') {
      const toNodeIds = new Set(toVault.nodes.map((n) => n.id));
      const remaining: NoteEdge[] = [];
      for (const edge of fromVault.edges) {
        const touches = edge.fromId === node.id || edge.toId === node.id;
        if (!touches) {
          remaining.push(edge);
          continue;
        }
        if (toNodeIds.has(edge.fromId) && toNodeIds.has(edge.toId)) {
          if (!toVault.edges.some((e) => e.id === edge.id)) {
            edge.updatedAt = t;
            toVault.edges.push(edge);
          }
        } else {
          await this.store.addNotesTrashItem({
            id: uuid(),
            entityType: 'edge',
            scope: from,
            entity: edge,
            deletedAt: t,
            reason: 'edge dropped on move (other end not in target scope)',
          });
        }
      }
      fromVault.edges = remaining.filter((e) => e.fromId !== node.id && e.toId !== node.id);
    }

    fromVault.updatedAt = t;
    toVault.updatedAt = t;
    await this.store.writeNotesVault(fromVault);
    await this.store.writeNotesVault(toVault);

    const rootVault = from.kind === 'root' ? fromVault : to.kind === 'root' ? toVault : undefined;
    const conversationVault =
      from.kind === 'conversation' ? fromVault : to.kind === 'conversation' ? toVault : undefined;

    return {
      ok: true,
      vault: toVault,
      rootVault,
      conversationVault,
      node,
    };
  }

  private async setLayout(
    op: Extract<NotesOp, { op: 'setLayout' }>,
    effective: ToolScopeConfig,
  ): Promise<NotesOpResult> {
    const scope = assertScope(op.scope);
    if (!canAccessNotesScope(effective, scope)) return this.deny(scope);

    const vault = await this.store.readNotesVault(scope);
    const t = nowIso();
    const byId = new Map(op.positions.map((p) => [p.nodeId, p]));
    for (const node of vault.nodes) {
      const pos = byId.get(node.id);
      if (pos) {
        node.x = pos.x;
        node.y = pos.y;
        node.updatedAt = t;
      }
    }
    vault.updatedAt = t;
    await this.store.writeNotesVault(vault);
    return { ok: true, vault };
  }
}
