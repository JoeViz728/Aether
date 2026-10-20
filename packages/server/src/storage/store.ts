import fs from 'node:fs/promises';
import path from 'node:path';
import { isApiKeyConfigured } from '../env.js';
import type {
  AppSettings,
  ApprovalRequest,
  Conversation,
  ExtensionManifest,
  NotesScopeRef,
  NotesTrashItem,
  NotesVault,
  Persona,
  Tool,
} from '@aether/shared';
import {
  DEFAULT_NOTES_SCOPE_DEFAULTS,
  emptyVault,
  ensureConversationTimestamps,
  mergeNotesScopeDefaults,
} from '@aether/shared';

const DEFAULT_SETTINGS: AppSettings = {
  apiKeyConfigured: false,
  defaultModel: 'grok-2',
  autoModelRouting: true,
  alwaysApproveBuilds: false,
  alwaysApproveScripts: false,
  theme: 'system',
  chatWidth: 'comfortable',
  bubbleResponses: false,
  bubblePrompts: false,
  mirroredMessagePadding: false,
  messagePaddingMobile: false,
  voice: {
    ttsEnabled: true,
    ttsVoice: 'eve',
    ttsPrefetchAhead: 2,
    ttsMinParagraphs: 3,
    sttEnabled: true,
    dictationOnNewChat: false,
    autoReadResponses: false,
  },
  notesScopeDefaults: { ...DEFAULT_NOTES_SCOPE_DEFAULTS },
  dataDir: '',
};

export class DataStore {
  constructor(private dataDir: string) {}

  private filePath(...segments: string[]): string {
    return path.join(this.dataDir, ...segments);
  }

  async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getSettings(): Promise<AppSettings> {
    const stored = await this.readJson(
      this.filePath('settings.json'),
      { ...DEFAULT_SETTINGS, dataDir: this.dataDir },
    );
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      voice: { ...DEFAULT_SETTINGS.voice, ...stored.voice },
      notesScopeDefaults: mergeNotesScopeDefaults(stored.notesScopeDefaults),
      dataDir: this.dataDir,
    };
    settings.apiKeyConfigured = isApiKeyConfigured();
    return settings;
  }

  async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...partial,
      voice: partial.voice ? { ...current.voice, ...partial.voice } : current.voice,
      notesScopeDefaults: partial.notesScopeDefaults
        ? mergeNotesScopeDefaults({
            ...current.notesScopeDefaults,
            ...partial.notesScopeDefaults,
            bareModel: partial.notesScopeDefaults.bareModel
              ?? current.notesScopeDefaults?.bareModel,
            withPersona: partial.notesScopeDefaults.withPersona
              ?? current.notesScopeDefaults?.withPersona,
            storyMode: partial.notesScopeDefaults.storyMode
              ?? current.notesScopeDefaults?.storyMode,
          })
        : current.notesScopeDefaults,
    };
    await this.writeJson(this.filePath('settings.json'), updated);
    return this.getSettings();
  }

  async listConversations(): Promise<Conversation[]> {
    const dir = this.filePath('conversations');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const conversations = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.readJson<Conversation>(path.join(dir, f), null as unknown as Conversation)),
    );

    return conversations
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const conversation = await this.readJson<Conversation | null>(
      this.filePath('conversations', `${id}.json`),
      null,
    );
    if (conversation) {
      if (!conversation.branchPoints) conversation.branchPoints = [];
      if (!conversation.storyCastPersonaIds) conversation.storyCastPersonaIds = [];
      conversation.settings = {
        autoModel: conversation.settings?.autoModel ?? true,
        enableWebSearch: conversation.settings?.enableWebSearch ?? true,
        enableXSearch: conversation.settings?.enableXSearch ?? true,
        enableCodeExecution: conversation.settings?.enableCodeExecution ?? true,
        enableMultiAgent: conversation.settings?.enableMultiAgent ?? true,
        dictationEnabled: conversation.settings?.dictationEnabled ?? false,
        storyMode: conversation.settings?.storyMode ?? false,
        toolScopes: conversation.settings?.toolScopes,
      };
      const { ensureBranchPoints } = await import('../services/branching.js');
      ensureBranchPoints(conversation);
      let dirty = ensureConversationTimestamps(conversation);
      // Legacy chats without lastReadAt are treated as already read at their last update.
      if (!conversation.lastReadAt) {
        conversation.lastReadAt = conversation.updatedAt;
        dirty = true;
      }
      if (dirty) {
        await this.saveConversation(conversation);
      }
    }
    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.writeJson(
      this.filePath('conversations', `${conversation.id}.json`),
      conversation,
    );
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath('conversations', `${id}.json`));
    } catch {
      /* ignore */
    }
  }

  async listApprovals(): Promise<ApprovalRequest[]> {
    const dir = this.filePath('approvals');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const approvals = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.readJson<ApprovalRequest>(path.join(dir, f), null as unknown as ApprovalRequest)),
    );

    return approvals.filter(Boolean);
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    return this.readJson<ApprovalRequest | null>(
      this.filePath('approvals', `${id}.json`),
      null,
    );
  }

  async saveApproval(approval: ApprovalRequest): Promise<void> {
    await this.writeJson(this.filePath('approvals', `${approval.id}.json`), approval);
  }

  async listExtensions(): Promise<ExtensionManifest[]> {
    const dir = this.filePath('extensions');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const extensions = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.readJson<ExtensionManifest>(path.join(dir, f), null as unknown as ExtensionManifest)),
    );

    return extensions.filter(Boolean);
  }

  async saveExtension(ext: ExtensionManifest): Promise<void> {
    await this.writeJson(this.filePath('extensions', `${ext.id}.json`), ext);
  }

  async listTools(): Promise<Tool[]> {
    const dir = this.filePath('tools');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const tools = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.readJson<Tool>(path.join(dir, f), null as unknown as Tool)),
    );

    return tools.filter(Boolean);
  }

  async saveTool(tool: Tool): Promise<void> {
    await this.writeJson(this.filePath('tools', `${tool.id}.json`), tool);
  }

  // ── Notes graph vaults ──────────────────────────────────────────────

  private notesVaultPath(scope: NotesScopeRef): string {
    if (scope.kind === 'root') {
      return this.filePath('notes', 'root.json');
    }
    if (!scope.conversationId) {
      throw new Error('conversation notes scope requires conversationId');
    }
    return this.filePath('notes', 'conversations', `${scope.conversationId}.json`);
  }

  async readNotesVault(scope: NotesScopeRef): Promise<NotesVault> {
    const normalized: NotesScopeRef =
      scope.kind === 'root'
        ? { kind: 'root' }
        : { kind: 'conversation', conversationId: scope.conversationId };
    const stored = await this.readJson<NotesVault | null>(this.notesVaultPath(normalized), null);
    if (!stored) return emptyVault(normalized);
    return {
      scope: normalized,
      nodes: Array.isArray(stored.nodes) ? stored.nodes : [],
      edges: Array.isArray(stored.edges) ? stored.edges : [],
      updatedAt: stored.updatedAt ?? new Date().toISOString(),
    };
  }

  async writeNotesVault(vault: NotesVault): Promise<void> {
    await this.writeJson(this.notesVaultPath(vault.scope), vault);
  }

  async listNotesTrash(): Promise<NotesTrashItem[]> {
    const items = await this.readJson<NotesTrashItem[]>(this.filePath('notes', 'trash.json'), []);
    return Array.isArray(items) ? items : [];
  }

  async addNotesTrashItem(item: NotesTrashItem): Promise<NotesTrashItem> {
    const items = await this.listNotesTrash();
    items.unshift(item);
    await this.writeJson(this.filePath('notes', 'trash.json'), items);
    return item;
  }

  async removeNotesTrashItem(id: string): Promise<boolean> {
    const items = await this.listNotesTrash();
    const next = items.filter((t) => t.id !== id);
    if (next.length === items.length) return false;
    await this.writeJson(this.filePath('notes', 'trash.json'), next);
    return true;
  }

  async emptyNotesTrash(): Promise<{ removed: number }> {
    const items = await this.listNotesTrash();
    await this.writeJson(this.filePath('notes', 'trash.json'), []);
    return { removed: items.length };
  }

  async listPersonas(): Promise<Persona[]> {
    const dir = this.filePath('personas');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const personas = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.readJson<Persona>(path.join(dir, f), null as unknown as Persona)),
    );

    return personas.filter(Boolean);
  }

  async getPersona(id: string): Promise<Persona | null> {
    return this.readJson<Persona | null>(this.filePath('personas', `${id}.json`), null);
  }

  personaAvatarPath(id: string): string {
    return this.filePath('personas', 'avatars', `${id}.png`);
  }

  async savePersonaAvatar(id: string, data: Uint8Array | Buffer): Promise<void> {
    await fs.mkdir(this.filePath('personas', 'avatars'), { recursive: true });
    await fs.writeFile(this.personaAvatarPath(id), data);
  }

  async hasPersonaAvatar(id: string): Promise<boolean> {
    try {
      await fs.access(this.personaAvatarPath(id));
      return true;
    } catch {
      return false;
    }
  }

  async savePersona(persona: Persona): Promise<void> {
    await this.writeJson(this.filePath('personas', `${persona.id}.json`), persona);
  }

  async deletePersona(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath('personas', `${id}.json`));
    } catch {
      /* ignore */
    }
    try {
      await fs.unlink(this.personaAvatarPath(id));
    } catch {
      /* ignore */
    }
  }
}