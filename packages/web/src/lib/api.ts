import type {
  AppSettings,
  ApprovalRequest,
  ChatCompletionRequest,
  Conversation,
  EditMessageRequest,
  ExtensionManifest,
  InitiateChatRequest,
  InsertResponseRequest,
  NotesOp,
  NotesOpResult,
  NotesTrashItem,
  NotesVault,
  Persona,
  RegenerateRequest,
  StreamEvent,
  TaskRecord,
  Tool,
  ToolScopeConfig,
} from '@aether/shared';

import { assertOnline } from './offline-debug';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  assertOnline();
  const headers = new Headers(options?.headers);
  if (options?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Request failed');
  }

  return res.json() as Promise<T>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
  messageCount: number;
  preview: string;
  unread?: boolean;
}

export const api = {
  health: () => request<{ status: string; apiKeyConfigured: boolean }>('/health'),

  getSettings: () => request<AppSettings>('/settings'),
  updateSettings: (data: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  listConversations: () => request<ConversationSummary[]>('/conversations'),
  getConversation: (id: string) => request<Conversation>(`/conversations/${id}`),
  createConversation: (data?: { title?: string; model?: string; activePersonaId?: string }) =>
    request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify(data ?? {}) }),

  seedConversationMessage: (
    conversationId: string,
    data: { content: string; personaId?: string },
  ) =>
    request<{ message: import('@aether/shared').ChatMessage; conversation: Conversation }>(
      `/conversations/${conversationId}/seed`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  updateConversation: (id: string, data: Partial<Conversation>) =>
    request<Conversation>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  markConversationRead: (id: string) =>
    request<Conversation>(`/conversations/${id}/read`, { method: 'POST' }),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),

  async *streamEndpoint(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    assertOnline();
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? 'Request failed');
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6)) as StreamEvent;
          } catch {
            /* skip malformed */
          }
        }
      }
    }
  },

  streamChat: (req: ChatCompletionRequest, signal?: AbortSignal) =>
    api.streamEndpoint('/chat', req, signal),
  streamRegenerate: (req: RegenerateRequest, signal?: AbortSignal) =>
    api.streamEndpoint('/chat/regenerate', req, signal),
  streamEdit: (req: EditMessageRequest, signal?: AbortSignal) =>
    api.streamEndpoint('/chat/edit', req, signal),
  streamInitiate: (req: InitiateChatRequest, signal?: AbortSignal) =>
    api.streamEndpoint('/chat/initiate', req, signal),
  streamInsert: (req: InsertResponseRequest, signal?: AbortSignal) =>
    api.streamEndpoint('/chat/insert', req, signal),

  listTasks: () => request<{ tasks: TaskRecord[] }>('/tasks'),
  cancelTask: (id: string) =>
    request<{ task: TaskRecord }>(`/tasks/${id}/cancel`, { method: 'POST' }),

  switchBranch: (conversationId: string, parentMessageId: string, target: 'live' | string) =>
    request<Conversation>('/chat/switch-branch', {
      method: 'POST',
      body: JSON.stringify({ conversationId, parentMessageId, target }),
    }),

  createPersona: async (data: Partial<Persona>, avatar?: Blob) => {
    if (avatar) {
      assertOnline();
      const form = new FormData();
      form.append('name', data.name ?? 'Unnamed');
      form.append('personality', data.personality ?? '');
      if (data.scenario) form.append('scenario', data.scenario);
      if (data.firstMessage) form.append('firstMessage', data.firstMessage);
      if (data.model != null) form.append('model', data.model);
      if (data.settings != null) form.append('settings', JSON.stringify(data.settings));
      if (data.toolScopes != null) form.append('toolScopes', JSON.stringify(data.toolScopes));
      form.append('avatar', avatar, 'avatar.png');

      const res = await fetch(`${API_BASE}/personas`, { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Request failed');
      }
      return res.json() as Promise<Persona>;
    }

    return request<Persona>('/personas', { method: 'POST', body: JSON.stringify(data) });
  },

  deletePersona: (id: string) =>
    request<{ ok: boolean }>(`/personas/${id}`, { method: 'DELETE' }),

  listPersonas: () => request<Persona[]>('/personas'),

  importPersona: (card: unknown) =>
    request<Persona>('/personas/import', { method: 'POST', body: JSON.stringify({ card }) }),

  updatePersona: async (id: string, data: Partial<Persona>, avatar?: Blob, removeAvatar?: boolean) => {
    if (avatar || removeAvatar) {
      assertOnline();
      const form = new FormData();
      if (data.name != null) form.append('name', data.name);
      if (data.personality != null) form.append('personality', data.personality);
      if (data.scenario != null) form.append('scenario', data.scenario);
      if (data.firstMessage != null) form.append('firstMessage', data.firstMessage);
      if (data.model != null) form.append('model', data.model);
      if (data.settings != null) form.append('settings', JSON.stringify(data.settings));
      if (data.toolScopes != null) form.append('toolScopes', JSON.stringify(data.toolScopes));
      if (avatar) form.append('avatar', avatar, 'avatar.png');
      if (removeAvatar) form.append('removeAvatar', 'true');

      const res = await fetch(`${API_BASE}/personas/${id}`, { method: 'PATCH', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Request failed');
      }
      return res.json() as Promise<Persona>;
    }

    return request<Persona>(`/personas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  importPersonaFile: async (file: File) => {
    assertOnline();
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${API_BASE}/personas/import`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? 'Request failed');
    }
    return res.json() as Promise<Persona>;
  },

  listApprovals: () => request<ApprovalRequest[]>('/approvals'),
  resolveApproval: (id: string, decision: 'approved' | 'denied') =>
    request<ApprovalRequest>(`/approvals/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),

  listVoices: () =>
    request<{ voices: Array<{ voice_id: string; name: string; description?: string }> }>(
      '/voice/voices',
    ),

  listModels: () => request<{ models: string[] }>('/models'),

  searchConversations: (q: string, limit?: number) => {
    const params = new URLSearchParams({ q });
    if (limit != null) params.set('limit', String(limit));
    return request<import('@aether/shared').ConversationSearchResponse>(
      `/search/conversations?${params.toString()}`,
    );
  },

  previewConversationImport: async (file: File) => {
    assertOnline();
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${API_BASE}/import/conversations/preview`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? 'Preview failed');
    }
    return res.json() as Promise<import('@aether/shared').ConversationImportPreviewResponse>;
  },

  commitConversationImport: (sessionId: string, conversationIds: string[]) =>
    request<import('@aether/shared').ConversationImportCommitResponse>(
      '/import/conversations/commit',
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, conversationIds }),
      },
    ),

  cancelConversationImport: (sessionId: string) =>
    request<{ ok: boolean }>('/import/conversations/cancel', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }).catch(() => ({ ok: false })),

  listTools: () => request<Tool[]>('/tools'),
  createTool: (data: Partial<Tool>) =>
    request<Tool>('/tools', { method: 'POST', body: JSON.stringify(data) }),
  updateTool: (id: string, data: Partial<Tool>) =>
    request<Tool>(`/tools/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getNotesVault: (opts: {
    scope: 'root' | 'conversation';
    conversationId?: string;
    personaId?: string;
  }) => {
    const q = new URLSearchParams({ scope: opts.scope });
    if (opts.conversationId) q.set('conversationId', opts.conversationId);
    if (opts.personaId) q.set('personaId', opts.personaId);
    return request<{
      vault: NotesVault;
      effective: ToolScopeConfig;
      source?: string;
      conversationOverride?: boolean;
      toolId: string;
    }>(`/notes?${q.toString()}`);
  },
  getNotesScope: (opts?: { conversationId?: string; personaId?: string }) => {
    const q = new URLSearchParams();
    if (opts?.conversationId) q.set('conversationId', opts.conversationId);
    if (opts?.personaId) q.set('personaId', opts.personaId);
    const qs = q.toString();
    return request<{
      effective: ToolScopeConfig;
      source?: import('@aether/shared').NotesScopeSource;
      conversationOverride?: boolean;
      defaults?: import('@aether/shared').NotesScopeDefaults;
      toolId: string;
    }>(`/notes/scope${qs ? `?${qs}` : ''}`);
  },
  notesOp: (
    op: NotesOp,
    ctx?: { conversationId?: string; personaId?: string; actor?: 'user' | 'model' },
  ) =>
    request<NotesOpResult>('/notes/ops', {
      method: 'POST',
      body: JSON.stringify({ op, actor: 'user', ...ctx }),
    }),
  listNotesTrash: () => request<{ items: NotesTrashItem[] }>('/notes/trash'),
  restoreNotesTrash: (trashId: string) =>
    request<NotesOpResult>('/notes/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ trashId }),
    }),
  emptyNotesTrash: () =>
    request<{ removed: number }>('/notes/trash/empty', { method: 'POST', body: '{}' }),
  setConversationNotesScope: (
    conversationId: string,
    config: ToolScopeConfig | { clear: true },
  ) =>
    request<{
      config: ToolScopeConfig | null;
      effective: ToolScopeConfig;
      source?: string;
      conversationOverride?: boolean;
      conversationId: string;
    }>(`/notes/scope/conversation/${conversationId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  tts: async (text: string, voice?: string): Promise<Blob | null> => {
    assertOnline();
    const res = await fetch(`${API_BASE}/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, language: 'en' }),
    });
    if (!res.ok) return null;
    return res.blob();
  },

  stt: async (audio: Blob): Promise<string | null> => {
    assertOnline();
    const form = new FormData();
    form.append('file', audio, 'recording.webm');
    const res = await fetch(`${API_BASE}/voice/stt`, { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = await res.json() as { text: string };
    return data.text;
  },

  listExtensions: () => request<ExtensionManifest[]>('/extensions'),
};