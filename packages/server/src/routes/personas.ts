import fs from 'node:fs/promises';
import { v4 as uuid } from 'uuid';
import type { FastifyInstance } from 'fastify';
import { finalizePersonaFields, parseCharacterCard } from '@aether/shared';
import {
  decodeCharacterCardJsonFromPng,
  isPngBytes,
} from '@aether/shared/character-card-png';
import type { Persona } from '@aether/shared';
import type { DataStore } from '../storage/store.js';

function personaAvatarUrl(id: string): string {
  return `/api/personas/${id}/avatar`;
}

function buildPersonaFromParsed(
  parsed: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>,
  now: string,
): Persona {
  const id = uuid();
  return {
    id,
    ...parsed,
    avatar: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function parseSettingsField(raw?: string): Persona['settings'] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as Persona['settings'];
  } catch {
    return undefined;
  }
}

function parseToolScopesField(raw?: string): Persona['toolScopes'] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as Persona['toolScopes'];
  } catch {
    return undefined;
  }
}

async function savePersonaWithAvatar(
  store: DataStore,
  persona: Persona,
  avatar?: Uint8Array | Buffer | null,
): Promise<Persona> {
  if (avatar && avatar.byteLength > 0) {
    await store.savePersonaAvatar(persona.id, avatar);
    persona.avatar = personaAvatarUrl(persona.id);
  }
  await store.savePersona(persona);
  return persona;
}

export async function registerPersonaRoutes(
  app: FastifyInstance,
  store: DataStore,
): Promise<void> {
  app.get('/api/personas', async () => store.listPersonas());

  app.get<{ Params: { id: string } }>('/api/personas/:id', async (req, reply) => {
    const persona = await store.getPersona(req.params.id);
    if (!persona) return reply.status(404).send({ error: 'Persona not found' });
    return persona;
  });

  app.get<{ Params: { id: string } }>('/api/personas/:id/avatar', async (req, reply) => {
    const avatarPath = store.personaAvatarPath(req.params.id);
    try {
      const data = await fs.readFile(avatarPath);
      return reply.type('image/png').send(data);
    } catch {
      return reply.status(404).send({ error: 'Avatar not found' });
    }
  });

  app.post('/api/personas', async (req, _reply) => {
    const now = new Date().toISOString();
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      const fields: Record<string, string> = {};
      let avatar: Buffer | null = null;

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'avatar') {
          avatar = await part.toBuffer();
        } else if (part.type === 'field') {
          fields[part.fieldname] = String(part.value);
        }
      }

      const finalized = finalizePersonaFields({
        name: fields.name ?? 'Unnamed',
        personality: fields.personality ?? '',
        scenario: fields.scenario,
        firstMessage: fields.firstMessage,
        model: fields.model || undefined,
        settings: parseSettingsField(fields.settings),
        toolScopes: parseToolScopesField(fields.toolScopes),
      });

      const persona = buildPersonaFromParsed(finalized, now);
      return savePersonaWithAvatar(store, persona, avatar);
    }

    const body = req.body as Partial<Persona>;
    const finalized = finalizePersonaFields({
      name: body.name ?? 'Unnamed',
      personality: body.personality ?? '',
      scenario: body.scenario,
      firstMessage: body.firstMessage,
      exampleDialogs: body.exampleDialogs,
      model: body.model,
      settings: body.settings,
      toolScopes: body.toolScopes,
    });

    const persona: Persona = {
      ...buildPersonaFromParsed(finalized, now),
    };
    await store.savePersona(persona);
    return persona;
  });

  app.patch<{ Params: { id: string } }>('/api/personas/:id', async (req, reply) => {
    const existing = await store.getPersona(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Persona not found' });

    const now = new Date().toISOString();
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      const fields: Record<string, string> = {};
      let avatar: Buffer | null | undefined;
      let removeAvatar = false;

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'avatar') {
          avatar = await part.toBuffer();
        } else if (part.type === 'field') {
          fields[part.fieldname] = String(part.value);
          if (part.fieldname === 'removeAvatar' && part.value === 'true') removeAvatar = true;
        }
      }

      const finalized = finalizePersonaFields({
        name: fields.name ?? existing.name,
        personality: fields.personality ?? existing.personality,
        scenario: fields.scenario ?? existing.scenario,
        firstMessage: fields.firstMessage ?? existing.firstMessage,
        exampleDialogs: existing.exampleDialogs,
        model: fields.model !== undefined ? (fields.model || undefined) : existing.model,
        settings: fields.settings !== undefined
          ? parseSettingsField(fields.settings)
          : existing.settings,
        toolScopes: fields.toolScopes !== undefined
          ? parseToolScopesField(fields.toolScopes)
          : existing.toolScopes,
      });

      const persona: Persona = {
        ...existing,
        ...finalized,
        updatedAt: now,
      };

      if (removeAvatar) {
        try {
          await fs.unlink(store.personaAvatarPath(persona.id));
        } catch {
          /* ignore */
        }
        persona.avatar = undefined;
      }

      if (avatar && avatar.byteLength > 0) {
        return savePersonaWithAvatar(store, persona, avatar);
      }

      await store.savePersona(persona);
      return persona;
    }

    const body = req.body as Partial<Persona>;
    const finalized = finalizePersonaFields({
      name: body.name ?? existing.name,
      personality: body.personality ?? existing.personality,
      scenario: body.scenario ?? existing.scenario,
      firstMessage: body.firstMessage ?? existing.firstMessage,
      exampleDialogs: body.exampleDialogs ?? existing.exampleDialogs,
      model: body.model !== undefined ? body.model : existing.model,
      settings: body.settings !== undefined ? body.settings : existing.settings,
      toolScopes: body.toolScopes !== undefined ? body.toolScopes : existing.toolScopes,
    });

    const persona: Persona = {
      ...existing,
      ...finalized,
      avatar: body.avatar ?? existing.avatar,
      updatedAt: now,
    };

    await store.savePersona(persona);
    return persona;
  });

  app.post('/api/personas/import', async (req, reply) => {
    const now = new Date().toISOString();
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      let fileBuffer: Buffer | null = null;
      let fileName = '';

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          fileName = part.filename ?? '';
        }
      }

      if (!fileBuffer) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const bytes = new Uint8Array(fileBuffer);
      const lowerName = fileName.toLowerCase();

      if (isPngBytes(bytes) || lowerName.endsWith('.png')) {
        try {
          const card = decodeCharacterCardJsonFromPng(bytes);
          const parsed = parseCharacterCard(card);
          const persona = buildPersonaFromParsed(parsed, now);
          return savePersonaWithAvatar(store, persona, fileBuffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid PNG character card';
          return reply.status(400).send({ error: message });
        }
      }

      try {
        const card = JSON.parse(fileBuffer.toString('utf8')) as unknown;
        const parsed = parseCharacterCard(card);
        const persona = buildPersonaFromParsed(parsed, now);
        await store.savePersona(persona);
        return persona;
      } catch {
        return reply.status(400).send({ error: 'Invalid character card file' });
      }
    }

    const body = req.body as { card: unknown };
    const parsed = parseCharacterCard(body.card);
    const persona = buildPersonaFromParsed(parsed, now);
    await store.savePersona(persona);
    return persona;
  });

  app.delete<{ Params: { id: string } }>('/api/personas/:id', async (req) => {
    await store.deletePersona(req.params.id);
    return { ok: true };
  });
}