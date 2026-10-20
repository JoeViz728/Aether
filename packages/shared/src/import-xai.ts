/**
 * Parse xAI / Grok data-export payloads into Aether conversations.
 *
 * Export layout (zip):
 *   ttl/30d/export_data/<userId>/prod-grok-backend.json
 * Or upload that JSON file directly.
 *
 * Shape:
 *   { conversations: Array<{ conversation, responses: Array<{ response }> }> }
 */

import type { ChatMessage, Conversation, ConversationSettings, ThinkingBlock } from './types.js';

const DEFAULT_SETTINGS: ConversationSettings = {
  autoModel: true,
  enableWebSearch: true,
  enableXSearch: true,
  enableCodeExecution: true,
  enableMultiAgent: true,
  dictationEnabled: false,
  storyMode: false,
};

export interface XaiImportResult {
  conversations: Conversation[];
  skipped: number;
  /** Human-readable notes (e.g. empty trees skipped) */
  warnings: string[];
  source: 'xai';
}

export interface XaiImportOptions {
  /** Default model when export has none */
  defaultModel?: string;
  /** Skip conversations with no importable messages (default true) */
  skipEmpty?: boolean;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalize Mongo-style / ISO timestamps from xAI exports. */
export function parseXaiTimestamp(value: unknown, fallback?: string): string {
  const fb = fallback ?? new Date().toISOString();
  if (value == null) return fb;

  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fb : d.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // seconds vs ms
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fb : d.toISOString();
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('$date' in obj) {
      return parseXaiTimestamp(obj.$date, fb);
    }
    if ('$numberLong' in obj) {
      const n = Number(obj.$numberLong);
      return Number.isFinite(n) ? parseXaiTimestamp(n, fb) : fb;
    }
  }

  return fb;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function mapSenderToRole(sender: string): 'user' | 'assistant' | null {
  const s = sender.trim().toLowerCase();
  if (!s) return null;
  if (s === 'human' || s === 'user') return 'user';
  if (s === 'assistant' || s === 'grok' || s.startsWith('grok-') || s.startsWith('aether')) {
    return 'assistant';
  }
  // Unknown model-name senders treated as assistant
  if (/^[a-z0-9._-]+$/i.test(sender) && !['system', 'tool', 'function'].includes(s)) {
    return 'assistant';
  }
  return null;
}

function extractModel(response: Record<string, unknown>, sender: string): string | undefined {
  const meta = isRecord(response.metadata) ? response.metadata : null;
  const req = meta && isRecord(meta.request_metadata) ? meta.request_metadata : null;
  const resolved = req ? asString(req.resolved_model) : '';
  if (resolved && resolved !== 'auto') return resolved;
  const modelField = asString(response.model);
  if (modelField) return modelField;
  const reqModel = req ? asString(req.model) : '';
  if (reqModel && reqModel !== 'auto') return reqModel;
  if (/^grok/i.test(sender)) return sender;
  return undefined;
}

function extractThinking(response: Record<string, unknown>, messageId: string): ThinkingBlock[] | undefined {
  const steps = response.steps;
  if (!Array.isArray(steps) || steps.length === 0) return undefined;

  const lines: string[] = [];
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const tagged = isRecord(step.tagged_text) ? step.tagged_text : null;
    if (!tagged) continue;
    for (const key of ['header', 'thinking', 'content', 'text']) {
      const t = asString(tagged[key]).trim();
      if (t) lines.push(t);
    }
  }

  if (lines.length === 0) return undefined;

  const startedAt = parseXaiTimestamp(response.create_time);
  return [
    {
      id: `${messageId}-think`,
      type: 'reasoning',
      agentLabel: 'Thinking',
      content: lines.join('\n'),
      status: 'complete',
      startedAt,
      completedAt: startedAt,
    },
  ];
}

function buildMessageChain(responses: unknown[], leafId: string | undefined): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of responses) {
    if (!isRecord(item)) continue;
    const resp = isRecord(item.response) ? item.response : item;
    const id = asString(resp._id) || asString(resp.id);
    if (!id) continue;
    byId.set(id, resp);
  }

  if (byId.size === 0) return [];

  // Prefer leaf → parent walk (active branch)
  if (leafId && byId.has(leafId)) {
    const chain: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = leafId;
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const node: Record<string, unknown> = byId.get(cur)!;
      chain.unshift(node);
      const parent = asString(node.parent_response_id);
      cur = parent || undefined;
      // Stop at synthetic roots not in the map
      if (cur && !byId.has(cur)) break;
    }
    if (chain.length > 0) return chain;
  }

  // Fallback: chronological
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(parseXaiTimestamp(a.create_time, '1970-01-01T00:00:00.000Z'));
    const tb = Date.parse(parseXaiTimestamp(b.create_time, '1970-01-01T00:00:00.000Z'));
    return ta - tb;
  });
}

function convertOneConversation(
  entry: unknown,
  opts: XaiImportOptions,
): Conversation | null {
  if (!isRecord(entry)) return null;
  const conv = isRecord(entry.conversation) ? entry.conversation : entry;
  const responsesRaw = Array.isArray(entry.responses) ? entry.responses : [];

  const title =
    asString(conv.title).trim()
    || asString(conv.summary).trim()
    || 'Imported chat';

  const createdAt = parseXaiTimestamp(conv.create_time);
  const updatedAt = parseXaiTimestamp(conv.modify_time, createdAt);
  const leafId = asString(conv.leaf_response_id) || undefined;
  const chain = buildMessageChain(responsesRaw, leafId);

  const messages: ChatMessage[] = [];
  let lastModel = opts.defaultModel ?? 'grok-2';

  for (const resp of chain) {
    const sender = asString(resp.sender);
    const role = mapSenderToRole(sender);
    if (!role) continue;

    const content = asString(resp.message).trim();
    if (!content) continue;

    const id = newId();
    const created = parseXaiTimestamp(resp.create_time, createdAt);
    const model = role === 'assistant' ? extractModel(resp, sender) : undefined;
    if (model) lastModel = model;

    const thinking = role === 'assistant' ? extractThinking(resp, id) : undefined;

    messages.push({
      id,
      role,
      content,
      createdAt: created,
      model: role === 'assistant' ? model ?? lastModel : undefined,
      thinking,
    });
  }

  if (messages.length === 0 && opts.skipEmpty !== false) {
    return null;
  }

  // Title fallback from first user line
  let finalTitle = title;
  if (!asString(conv.title).trim()) {
    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) {
      finalTitle =
        firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '…' : '');
    }
  }

  return {
    id: newId(),
    title: finalTitle,
    messages,
    branchPoints: [],
    model: lastModel,
    createdAt,
    updatedAt,
    lastReadAt: updatedAt,
    settings: { ...DEFAULT_SETTINGS },
    storyCastPersonaIds: [],
  };
}

/**
 * Detect and parse an xAI export JSON root object (prod-grok-backend.json contents).
 */
export function isXaiGrokBackendExport(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (!Array.isArray(data.conversations)) return false;
  if (data.conversations.length === 0) return true;
  const first = data.conversations[0];
  if (!isRecord(first)) return false;
  return isRecord(first.conversation) || Array.isArray(first.responses) || typeof first.title === 'string';
}

export function importXaiGrokBackendExport(
  data: unknown,
  opts: XaiImportOptions = {},
): XaiImportResult {
  if (!isXaiGrokBackendExport(data)) {
    throw new Error(
      'Not a recognized xAI Grok export. Expected JSON with a top-level "conversations" array (prod-grok-backend.json).',
    );
  }

  const root = data as Record<string, unknown>;
  const list = root.conversations as unknown[];
  const conversations: Conversation[] = [];
  let skipped = 0;
  const warnings: string[] = [];

  for (const entry of list) {
    try {
      const conv = convertOneConversation(entry, opts);
      if (!conv) {
        skipped += 1;
        continue;
      }
      conversations.push(conv);
    } catch (err) {
      skipped += 1;
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (conversations.length === 0 && list.length > 0) {
    warnings.push('No conversations with importable messages were found.');
  }

  // Newest first (matches Aether sidebar sort)
  conversations.sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );

  return {
    conversations,
    skipped,
    warnings: warnings.slice(0, 20),
    source: 'xai',
  };
}

/**
 * Try to locate prod-grok-backend.json text among candidate file paths/names.
 */
export function pickXaiBackendJson(
  files: Array<{ name: string; content: string }>,
): { name: string; content: string } | null {
  const normalized = files.map((f) => ({
    ...f,
    base: f.name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '',
    path: f.name.replace(/\\/g, '/').toLowerCase(),
  }));

  const exact = normalized.find((f) => f.base === 'prod-grok-backend.json');
  if (exact) return { name: exact.name, content: exact.content };

  for (const f of normalized) {
    if (!f.base.endsWith('.json')) continue;
    try {
      const data = JSON.parse(f.content) as unknown;
      if (isXaiGrokBackendExport(data)) {
        return { name: f.name, content: f.content };
      }
    } catch {
      /* skip */
    }
  }

  return null;
}
