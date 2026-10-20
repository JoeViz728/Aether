import type { ChatMessage, Conversation } from './types.js';

export type SearchMatchField =
  | 'title'
  | 'content'
  | 'model'
  | 'timestamp'
  | 'role'
  | 'conversation';

export interface ConversationSearchHit {
  id: string;
  conversationId: string;
  conversationTitle: string;
  /** Present when the hit is a specific message */
  messageId?: string;
  role?: ChatMessage['role'];
  model?: string;
  /** ISO times for display / further filtering */
  createdAt?: string;
  updatedAt?: string;
  matchField: SearchMatchField;
  /** Short snippet with the match context */
  snippet: string;
  score: number;
}

export interface ConversationSearchResponse {
  query: string;
  hits: ConversationSearchHit[];
  scannedConversations: number;
  truncated: boolean;
}

const MAX_HITS = 80;
const SNIPPET_RADIUS = 70;

function normalizeQuery(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function scoreText(haystack: string, terms: string[]): number {
  if (!haystack || terms.length === 0) return 0;
  const h = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (h === term) score += 100;
    else if (h.startsWith(term)) score += 40;
    else if (h.includes(term)) score += 20;
  }
  // Phrase bonus
  const phrase = terms.join(' ');
  if (phrase.length > 2 && h.includes(phrase)) score += 30;
  return score;
}

function snippetAround(text: string, terms: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) {
    return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(clean.length, idx + SNIPPET_RADIUS + 20);
  const slice = clean.slice(start, end);
  return `${start > 0 ? '…' : ''}${slice}${end < clean.length ? '…' : ''}`;
}

function timestampHaystack(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.toLowerCase();
  const parts = [
    iso.toLowerCase(),
    d.toISOString().toLowerCase(),
    d.toLocaleString().toLowerCase(),
    d.toLocaleDateString().toLowerCase(),
    d.toLocaleTimeString().toLowerCase(),
    // Common absolute forms
    `${d.getFullYear()}`,
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  ];
  return parts.join(' ');
}

function pushHit(hits: ConversationSearchHit[], hit: ConversationSearchHit): void {
  hits.push(hit);
}

/**
 * Search one conversation (title, models, timestamps, message bodies).
 * Pure — safe for client or server.
 */
export function searchConversation(
  conversation: Conversation,
  query: string,
): ConversationSearchHit[] {
  const terms = normalizeQuery(query);
  if (terms.length === 0) return [];

  const hits: ConversationSearchHit[] = [];
  const title = conversation.title ?? '';
  const titleScore = scoreText(title, terms) * 1.4;
  if (titleScore > 0) {
    pushHit(hits, {
      id: `${conversation.id}:title`,
      conversationId: conversation.id,
      conversationTitle: title || 'Untitled',
      matchField: 'title',
      snippet: title,
      score: titleScore + 15,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      model: conversation.model,
    });
  }

  const convTimeHay = `${timestampHaystack(conversation.createdAt)} ${timestampHaystack(conversation.updatedAt)}`;
  const convTimeScore = scoreText(convTimeHay, terms);
  if (convTimeScore > 0) {
    pushHit(hits, {
      id: `${conversation.id}:conv-time`,
      conversationId: conversation.id,
      conversationTitle: title || 'Untitled',
      matchField: 'timestamp',
      snippet: `Chat · ${conversation.updatedAt || conversation.createdAt || ''}`,
      score: convTimeScore + 5,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      model: conversation.model,
    });
  }

  const convModelScore = scoreText(conversation.model ?? '', terms);
  if (convModelScore > 0) {
    pushHit(hits, {
      id: `${conversation.id}:conv-model`,
      conversationId: conversation.id,
      conversationTitle: title || 'Untitled',
      matchField: 'model',
      snippet: `Conversation model: ${conversation.model}`,
      score: convModelScore + 8,
      model: conversation.model,
      updatedAt: conversation.updatedAt,
    });
  }

  const seenMessages = new Set<string>();
  const consider = (msg: ChatMessage) => {
    if (seenMessages.has(msg.id)) return;
    seenMessages.add(msg.id);

    const contentScore = scoreText(msg.content ?? '', terms);
    const modelScore = scoreText(msg.model ?? '', terms) * 1.1;
    const timeScore = scoreText(timestampHaystack(msg.createdAt), terms);
    const roleScore = scoreText(msg.role, terms) * 0.5;
    const responderScore = scoreText(msg.responderName ?? '', terms);

    const best = Math.max(contentScore, modelScore, timeScore, roleScore, responderScore);
    if (best <= 0) return;

    let matchField: SearchMatchField = 'content';
    let snippet = snippetAround(msg.content ?? '', terms);
    if (modelScore >= best && modelScore > 0) {
      matchField = 'model';
      snippet = msg.model ?? snippet;
    } else if (timeScore >= best && timeScore > contentScore) {
      matchField = 'timestamp';
      snippet = msg.createdAt ? `${msg.createdAt} · ${snippetAround(msg.content ?? '', terms)}` : snippet;
    } else if (roleScore >= best && roleScore > contentScore) {
      matchField = 'role';
      snippet = `${msg.role}: ${snippetAround(msg.content ?? '', terms)}`;
    }

    pushHit(hits, {
      id: `${conversation.id}:msg:${msg.id}:${matchField}`,
      conversationId: conversation.id,
      conversationTitle: title || 'Untitled',
      messageId: msg.id,
      role: msg.role,
      model: msg.model ?? conversation.model,
      createdAt: msg.createdAt,
      updatedAt: conversation.updatedAt,
      matchField,
      snippet: snippet || '(empty message)',
      score: best + (msg.role === 'user' ? 2 : 0),
    });
  };

  for (const msg of conversation.messages) consider(msg);
  for (const bp of conversation.branchPoints ?? []) {
    for (const branch of bp.archived ?? []) {
      for (const msg of branch.tail) consider(msg);
    }
    if (bp.liveTail) {
      for (const msg of bp.liveTail) consider(msg);
    }
  }

  return hits;
}

export function searchConversations(
  conversations: Conversation[],
  query: string,
  limit = MAX_HITS,
): ConversationSearchResponse {
  const terms = normalizeQuery(query);
  if (terms.length === 0) {
    return { query, hits: [], scannedConversations: 0, truncated: false };
  }

  const all: ConversationSearchHit[] = [];
  for (const c of conversations) {
    all.push(...searchConversation(c, query));
  }

  all.sort((a, b) => b.score - a.score || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const truncated = all.length > limit;
  return {
    query: query.trim(),
    hits: all.slice(0, limit),
    scannedConversations: conversations.length,
    truncated,
  };
}
