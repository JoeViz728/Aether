import type {
  MessageAugmentation,
  NotesFunctionArgs,
  NotesOpResult,
  NotesScopeRef,
  NotesVault,
  ToolScopeConfig,
} from '@aether/shared';
import {
  AETHER_NOTES_FUNCTION_NAME,
  AETHER_NOTES_FUNCTION_TOOL,
  buildNotesAugmentation,
  buildNotesSystemPromptSection,
  canAccessNotesScope,
  formatNotesAmbientSnapshot,
  narrateNotesAction,
  notesArgsToDispatch,
  parseNotesFunctionArgs,
  rankNotesSearch,
  summarizeVaultForModel,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';
import { NotesService } from './notes-service.js';
import type { FunctionToolDef } from './xai-client.js';

export { AETHER_NOTES_FUNCTION_NAME, AETHER_NOTES_FUNCTION_TOOL };

export interface NotesToolExecution {
  ok: boolean;
  summary: string;
  detail?: string;
  output: Record<string, unknown>;
  augmentation?: MessageAugmentation | null;
  args: NotesFunctionArgs;
}

export class NotesToolHandler {
  private notes: NotesService;

  constructor(private store: DataStore) {
    this.notes = new NotesService(store);
  }

  functionTool(): FunctionToolDef {
    return { ...AETHER_NOTES_FUNCTION_TOOL };
  }

  async resolveScope(conversationId?: string, personaId?: string): Promise<ToolScopeConfig> {
    return this.notes.resolveEffectiveConfig({ conversationId, personaId });
  }

  async resolveScopeDetailed(conversationId?: string, personaId?: string) {
    return this.notes.resolveEffectiveScope({ conversationId, personaId });
  }

  /**
   * Full system prompt block including live vault snapshot so the model
   * does not need an explicit list/search to know what is on the board.
   */
  async buildSystemSection(
    effective: ToolScopeConfig,
    conversationId?: string,
  ): Promise<string> {
    const { chat, root } = await this.loadAccessibleVaults(effective, conversationId);
    const ambientSnapshot = formatNotesAmbientSnapshot({
      access: effective.access,
      conversationId,
      chat,
      root,
      maxNodes: 20,
    });

    return buildNotesSystemPromptSection({
      access: effective.access,
      allowPromoteToRoot: effective.allowMoveToRoot ?? effective.allowPromoteToRoot !== false,
      allowMoveFromRoot: effective.allowMoveFromRoot === true,
      conversationId,
      ambientSnapshot,
    });
  }

  /** @deprecated prefer buildSystemSection */
  systemPromptSection(effective: ToolScopeConfig, conversationId?: string): string {
    return buildNotesSystemPromptSection({
      access: effective.access,
      allowPromoteToRoot: effective.allowMoveToRoot ?? effective.allowPromoteToRoot !== false,
      allowMoveFromRoot: effective.allowMoveFromRoot === true,
      conversationId,
    });
  }

  async execute(
    rawArgs: unknown,
    ctx: { conversationId?: string; personaId?: string },
  ): Promise<NotesToolExecution> {
    let args: NotesFunctionArgs;
    try {
      args = parseNotesFunctionArgs(rawArgs);
    } catch (err) {
      return {
        ok: false,
        summary: 'Invalid notes tool call',
        detail: err instanceof Error ? err.message : String(err),
        output: { error: err instanceof Error ? err.message : String(err) },
        args: { action: 'unknown' },
      };
    }

    try {
      const effective = await this.notes.resolveEffectiveConfig({
        conversationId: ctx.conversationId,
        personaId: ctx.personaId,
      });
      const dispatch = notesArgsToDispatch(args, ctx.conversationId);

      if (dispatch.kind === 'locate') {
        const found = await this.findNodeAcrossVaults(
          dispatch.nodeId,
          effective,
          ctx.conversationId,
        );
        if (!found) {
          return {
            ok: false,
            summary: 'Note not found',
            output: { error: 'Note not found in accessible scopes', nodeId: dispatch.nodeId },
            args,
          };
        }
        const scopedArgs: NotesFunctionArgs = {
          ...dispatch.args,
          scope: found.scope.kind,
        };
        const opDispatch = notesArgsToDispatch(scopedArgs, ctx.conversationId);
        if (opDispatch.kind !== 'op') {
          return {
            ok: false,
            summary: 'Could not resolve update',
            output: { error: 'Internal dispatch error' },
            args,
          };
        }
        return this.runOp(opDispatch.op, args, ctx);
      }

      if (dispatch.kind === 'read') {
        return this.runRead(dispatch, args, effective, ctx.conversationId);
      }

      return this.runOp(dispatch.op, args, ctx);
    } catch (err) {
      return {
        ok: false,
        summary: narrateNotesAction(args, 'done'),
        detail: err instanceof Error ? err.message : String(err),
        output: { error: err instanceof Error ? err.message : String(err) },
        args,
      };
    }
  }

  private async runOp(
    op: Parameters<NotesService['applyOp']>[0],
    args: NotesFunctionArgs,
    ctx: { conversationId?: string; personaId?: string },
  ): Promise<NotesToolExecution> {
    const result = await this.notes.applyOp(op, {
      conversationId: ctx.conversationId,
      personaId: ctx.personaId,
      actor: 'model',
    });

    if (!result.ok) {
      return {
        ok: false,
        summary: narrateNotesAction(args, 'done'),
        detail: result.error,
        output: { error: result.error },
        args,
      };
    }

    const augmentation = buildNotesAugmentation(args, result, ctx.conversationId);
    const title = result.node?.title ?? args.title;
    return {
      ok: true,
      summary: narrateNotesAction({ ...args, title: title ?? args.title }, 'done'),
      output: {
        ok: true,
        node: result.node
          ? {
              id: result.node.id,
              title: result.node.title,
              type: result.node.type,
              bodyPreview: result.node.body.slice(0, 200),
            }
          : undefined,
        edge: result.edge
          ? {
              id: result.edge.id,
              fromId: result.edge.fromId,
              toId: result.edge.toId,
              label: result.edge.label,
            }
          : undefined,
        scope: result.vault?.scope ?? result.rootVault?.scope,
        nodeCount: result.vault?.nodes.length ?? result.rootVault?.nodes.length,
        edgeCount: result.vault?.edges.length ?? result.rootVault?.edges.length,
      },
      augmentation,
      args,
    };
  }

  private async runRead(
    dispatch: Extract<ReturnType<typeof notesArgsToDispatch>, { kind: 'read' }>,
    args: NotesFunctionArgs,
    effective: ToolScopeConfig,
    conversationId?: string,
  ): Promise<NotesToolExecution> {
    const sources = dispatch.multi
      ? await this.accessibleSources(effective, conversationId)
      : dispatch.scope
        ? [{ vault: await this.notes.getVault(dispatch.scope), scope: dispatch.scope }]
        : await this.accessibleSources(effective, conversationId);

    if (sources.length === 0) {
      return {
        ok: false,
        summary: 'No notes vaults accessible',
        output: { error: 'No accessible notes scopes', access: effective.access },
        args,
      };
    }

    if (dispatch.read === 'list') {
      const vaults = sources.map((s) => summarizeVaultForModel(s.vault, 40));
      const totalNodes = sources.reduce((n, s) => n + s.vault.nodes.length, 0);
      const totalEdges = sources.reduce((n, s) => n + s.vault.edges.length, 0);
      const mergedNodes = sources.flatMap((s) => s.vault.nodes);
      const primary = sources[0].vault;
      const result: NotesOpResult & { vault: NotesVault } = {
        ok: true,
        vault: { ...primary, nodes: mergedNodes },
      };
      const augmentation = buildNotesAugmentation(args, result, conversationId);
      return {
        ok: true,
        summary: narrateNotesAction(args, 'done', `${totalNodes} notes across ${sources.length} vault(s)`),
        output: {
          multi: sources.length > 1,
          totalNodes,
          totalEdges,
          vaults,
        },
        augmentation,
        args,
      };
    }

    if (dispatch.read === 'get_node') {
      for (const { vault, scope } of sources) {
        const node = vault.nodes.find((n) => n.id === dispatch.nodeId);
        if (!node) continue;
        const neighbors = vault.edges
          .filter((e) => e.fromId === node.id || e.toId === node.id)
          .map((e) => ({
            id: e.id,
            label: e.label,
            otherId: e.fromId === node.id ? e.toId : e.fromId,
            otherTitle: vault.nodes.find((x) => x.id === (e.fromId === node.id ? e.toId : e.fromId))?.title,
            outbound: e.fromId === node.id,
          }));
        const result: NotesOpResult & { vault: NotesVault; node: typeof node } = {
          ok: true,
          vault,
          node,
        };
        const augmentation = buildNotesAugmentation(
          { ...args, nodeId: node.id, scope: scope.kind },
          result,
          conversationId,
        );
        return {
          ok: true,
          summary: narrateNotesAction(args, 'done', node.title),
          output: { node, neighbors, scope },
          augmentation,
          args,
        };
      }
      return {
        ok: false,
        summary: 'Note not found',
        output: { error: 'Note not found', nodeId: dispatch.nodeId, searchedScopes: sources.map((s) => s.scope) },
        args,
      };
    }

    // search — multi-scope ranked
    const hits = rankNotesSearch(sources, dispatch.query ?? '');
    const primaryVault = sources[0]?.vault;
    const result: NotesOpResult & { vault: NotesVault } = {
      ok: true,
      vault: {
        ...(primaryVault ?? {
          scope: { kind: 'root' as const },
          nodes: [],
          edges: [],
          updatedAt: new Date().toISOString(),
        }),
        nodes: hits.map((h) => h.node),
      },
    };
    const augmentation = buildNotesAugmentation(args, result, conversationId);
    return {
      ok: true,
      summary: narrateNotesAction(args, 'done', `${hits.length} match(es)`),
      output: {
        query: dispatch.query,
        count: hits.length,
        multi: sources.length > 1,
        nodes: hits.map((h) => ({
          id: h.node.id,
          title: h.node.title,
          type: h.node.type,
          tags: h.node.tags,
          bodyPreview: h.node.body.slice(0, 160),
          scope: h.scope,
          score: h.score,
        })),
      },
      augmentation,
      args,
    };
  }

  private async loadAccessibleVaults(
    effective: ToolScopeConfig,
    conversationId?: string,
  ): Promise<{ chat: NotesVault | null; root: NotesVault | null }> {
    let chat: NotesVault | null = null;
    let root: NotesVault | null = null;

    if (conversationId && canAccessNotesScope(effective, { kind: 'conversation', conversationId })) {
      chat = await this.notes.getVault({ kind: 'conversation', conversationId });
    }
    if (canAccessNotesScope(effective, { kind: 'root' })) {
      root = await this.notes.getVault({ kind: 'root' });
    }
    return { chat, root };
  }

  private async accessibleSources(
    effective: ToolScopeConfig,
    conversationId?: string,
  ): Promise<Array<{ vault: NotesVault; scope: NotesScopeRef }>> {
    const { chat, root } = await this.loadAccessibleVaults(effective, conversationId);
    const out: Array<{ vault: NotesVault; scope: NotesScopeRef }> = [];
    // Chat first so case-local hits rank/list first when scores tie
    if (chat) out.push({ vault: chat, scope: chat.scope });
    if (root) out.push({ vault: root, scope: root.scope });
    return out;
  }

  private async findNodeAcrossVaults(
    nodeId: string,
    effective: ToolScopeConfig,
    conversationId?: string,
  ): Promise<{ node: NotesVault['nodes'][0]; scope: NotesScopeRef } | null> {
    const sources = await this.accessibleSources(effective, conversationId);
    for (const { vault, scope } of sources) {
      const node = vault.nodes.find((n) => n.id === nodeId);
      if (node) return { node, scope };
    }
    return null;
  }
}
