import { randomUUID } from 'node:crypto';
import { fromBuffer as yauzlFromBuffer } from 'yauzl';
import type { Readable } from 'node:stream';
import type {
  Conversation,
  ConversationImportCommitResponse,
  ConversationImportPreview,
  ConversationImportPreviewResponse,
} from '@aether/shared';
import {
  importXaiGrokBackendExport,
  isXaiGrokBackendExport,
  pickXaiBackendJson,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

interface ImportSession {
  id: string;
  source: 'xai' | 'aether' | 'unknown';
  createdAt: number;
  expiresAt: number;
  skipped: number;
  warnings: string[];
  /** Full conversations ready to save (keyed by id). */
  byId: Map<string, Conversation>;
}

const sessions = new Map<string, ImportSession>();

function pruneSessions(now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** Read selected text files from a zip buffer (by filename filter). */
export async function readZipTextFiles(
  zipBuffer: Buffer,
  opts?: { maxFiles?: number; maxFileBytes?: number },
): Promise<Array<{ name: string; content: string }>> {
  const maxFiles = opts?.maxFiles ?? 40;
  const maxFileBytes = opts?.maxFileBytes ?? 200 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    yauzlFromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Failed to open zip'));
        return;
      }

      const files: Array<{ name: string; content: string }> = [];
      let pending = 0;
      let ended = false;

      const maybeDone = () => {
        if (ended && pending === 0) resolve(files);
      };

      zipfile.on('error', reject);
      zipfile.on('end', () => {
        ended = true;
        maybeDone();
      });

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        const base = name.split('/').pop()?.toLowerCase() ?? '';
        const isDir = /\/$/.test(name);

        const want =
          !isDir &&
          (base === 'prod-grok-backend.json' ||
            (base.endsWith('.json') && name.includes('export_data')));

        if (!want || files.length >= maxFiles) {
          zipfile.readEntry();
          return;
        }

        if (entry.uncompressedSize > maxFileBytes) {
          zipfile.readEntry();
          return;
        }

        pending += 1;
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            pending -= 1;
            reject(streamErr ?? new Error(`Failed to read ${name}`));
            return;
          }
          void streamToBuffer(stream)
            .then((buf) => {
              files.push({ name, content: buf.toString('utf8') });
              pending -= 1;
              zipfile.readEntry();
              maybeDone();
            })
            .catch((e) => {
              pending -= 1;
              reject(e);
            });
        });
      });
    });
  });
}

function toPreview(conversation: Conversation, sampleLimit = 8): ConversationImportPreview {
  const sampleMessages = conversation.messages.slice(0, sampleLimit).map((m) => ({
    role: m.role,
    content:
      m.content.length > 600 ? `${m.content.slice(0, 600).trimEnd()}…` : m.content,
  }));

  const firstUser = conversation.messages.find((m) => m.role === 'user');
  const preview = (firstUser?.content ?? conversation.messages[0]?.content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return {
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation.messages.length,
    userMessageCount: conversation.messages.filter((m) => m.role === 'user').length,
    assistantMessageCount: conversation.messages.filter((m) => m.role === 'assistant').length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    model: conversation.model,
    preview,
    sampleMessages,
  };
}

export class ImportService {
  constructor(private store: DataStore) {}

  /** Parse upload into a temporary session — nothing is written to disk yet. */
  async previewFromUpload(
    filename: string,
    buffer: Buffer,
  ): Promise<ConversationImportPreviewResponse> {
    pruneSessions();
    const { conversations, skipped, warnings, source } = await this.parseUpload(
      filename,
      buffer,
    );

    const now = Date.now();
    const sessionId = randomUUID();
    const byId = new Map(conversations.map((c) => [c.id, c]));

    sessions.set(sessionId, {
      id: sessionId,
      source,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      skipped,
      warnings,
      byId,
    });

    return {
      sessionId,
      source,
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      skipped,
      warnings,
      conversations: conversations.map((c) => toPreview(c)),
    };
  }

  /** Persist selected conversations from a preview session. */
  async commitSession(
    sessionId: string,
    conversationIds: string[],
  ): Promise<ConversationImportCommitResponse> {
    pruneSessions();
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error('Import session expired or not found. Upload the export again to preview.');
    }
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      throw new Error('Import session expired. Upload the export again to preview.');
    }

    const uniqueIds = [...new Set(conversationIds)];
    const toSave: Conversation[] = [];
    const missing: string[] = [];

    for (const id of uniqueIds) {
      const c = session.byId.get(id);
      if (c) toSave.push(c);
      else missing.push(id);
    }

    const conversationIdsSaved: string[] = [];
    for (const conversation of toSave) {
      await this.store.saveConversation(conversation);
      conversationIdsSaved.push(conversation.id);
    }

    // Drop session after commit so a double-submit cannot duplicate.
    sessions.delete(sessionId);

    const warnings = [...session.warnings];
    if (missing.length > 0) {
      warnings.push(`${missing.length} selected id(s) were not in the session.`);
    }

    return {
      imported: conversationIdsSaved.length,
      skipped: session.skipped + (uniqueIds.length - toSave.length),
      warnings: warnings.slice(0, 20),
      source: session.source,
      conversationIds: conversationIdsSaved,
    };
  }

  cancelSession(sessionId: string): boolean {
    return sessions.delete(sessionId);
  }

  private async parseUpload(
    filename: string,
    buffer: Buffer,
  ): Promise<{
    conversations: Conversation[];
    skipped: number;
    warnings: string[];
    source: 'xai' | 'aether' | 'unknown';
  }> {
    const lower = filename.toLowerCase();
    let jsonText: string | null = null;
    let parseSource = filename;

    if (lower.endsWith('.zip')) {
      const files = await readZipTextFiles(buffer);
      const picked = pickXaiBackendJson(files);
      if (!picked) {
        throw new Error(
          'Zip did not contain a recognizable xAI export (expected prod-grok-backend.json under export_data).',
        );
      }
      jsonText = picked.content;
      parseSource = picked.name;
    } else if (lower.endsWith('.json')) {
      jsonText = buffer.toString('utf8');
    } else {
      throw new Error('Unsupported file type. Upload an xAI export .zip or prod-grok-backend.json.');
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      throw new Error(`Invalid JSON in ${parseSource}`);
    }

    if (!isXaiGrokBackendExport(data)) {
      throw new Error(
        'JSON is not an xAI Grok backend export. Expected a top-level "conversations" array.',
      );
    }

    const settings = await this.store.getSettings();
    const parsed = importXaiGrokBackendExport(data, {
      defaultModel: settings.defaultModel || 'grok-2',
      skipEmpty: true,
    });

    return {
      conversations: parsed.conversations,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      source: 'xai',
    };
  }
}
