import type { CharacterCard, ConversationSettings, ExampleDialog, Persona } from './types.js';

export function getPersonaAvatarSrc(persona: Persona | null | undefined): string | null {
  if (!persona?.avatar || persona.avatar === 'none') return null;
  if (persona.avatar.startsWith('/api/')) return persona.avatar;
  return `/api/personas/${persona.id}/avatar`;
}

/** Boolean chat toggles only — toolScopes merges separately (object, not flipped). */
const BOOLEAN_SETTING_KEYS = [
  'autoModel',
  'enableWebSearch',
  'enableXSearch',
  'enableCodeExecution',
  'enableMultiAgent',
  'dictationEnabled',
  'storyMode',
] as const satisfies readonly (keyof ConversationSettings)[];

export function resolveChatSettings(
  conversation: ConversationSettings,
  persona?: Persona | null,
  request?: Partial<ConversationSettings> | null,
): ConversationSettings {
  const result: ConversationSettings = { ...conversation };
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (request?.[key] !== undefined) {
      result[key] = request[key];
    } else if (persona?.settings?.[key] !== undefined) {
      result[key] = persona.settings[key];
    }
  }
  // toolScopes: request overrides conversation; persona defaults live on persona.toolScopes (not settings)
  if (request?.toolScopes !== undefined) {
    result.toolScopes = request.toolScopes;
  }
  return result;
}

export function finalizePersonaFields(
  fields: Pick<Persona, 'name' | 'personality'> & Partial<Persona>,
): Pick<
  Persona,
  'name' | 'personality' | 'scenario' | 'firstMessage' | 'exampleDialogs' | 'model' | 'settings' | 'systemPrompt' | 'toolScopes'
> {
  const persona: Persona = {
    id: '',
    name: fields.name,
    personality: fields.personality,
    scenario: fields.scenario,
    firstMessage: fields.firstMessage,
    exampleDialogs: fields.exampleDialogs,
    model: fields.model,
    settings: fields.settings,
    toolScopes: fields.toolScopes,
    createdAt: '',
    updatedAt: '',
  };

  return {
    name: persona.name,
    personality: persona.personality,
    scenario: persona.scenario,
    firstMessage: persona.firstMessage,
    exampleDialogs: persona.exampleDialogs,
    model: persona.model,
    settings: persona.settings,
    toolScopes: persona.toolScopes,
    systemPrompt: buildPersonaSystemPrompt(persona),
  };
}

export function buildPersonaSystemPrompt(persona: Persona): string {
  const parts: string[] = [
    `You are ${persona.name}. Stay fully in character at all times.`,
  ];

  if (persona.personality) {
    parts.push(`\n## Personality\n${persona.personality}`);
  }

  if (persona.scenario) {
    parts.push(`\n## Scenario\n${persona.scenario}`);
  }

  if (persona.exampleDialogs?.length) {
    parts.push('\n## Example Dialogs');
    for (const ex of persona.exampleDialogs) {
      parts.push(`User: ${ex.user}\n${persona.name}: ${ex.assistant}`);
    }
  }

  return parts.join('\n');
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeCharacterCardRaw(raw: unknown): Record<string, unknown> {
  const root = raw as Record<string, unknown>;
  const nested = root.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...root, ...(nested as Record<string, unknown>) };
  }
  return root;
}

export function parseCharacterCard(raw: unknown): Omit<Persona, 'id' | 'createdAt' | 'updatedAt'> {
  const data = normalizeCharacterCardRaw(raw);

  const name = pickString(data.name, data.char_name, data.character_name) || 'Unnamed';
  const personality = pickString(data.personality, data.description, data.char_persona);
  const scenario = pickString(data.scenario, data.world_scenario, data.char_scenario);
  const firstMessage = pickString(data.first_message, data.first_mes, data.greeting);

  let exampleDialogs: ExampleDialog[] = [];
  const mesExample = data.mes_example ?? data.example_dialogue ?? data.examples;
  if (typeof mesExample === 'string' && mesExample.trim()) {
    exampleDialogs = parseExampleDialogString(mesExample);
  } else if (Array.isArray(mesExample)) {
    exampleDialogs = mesExample.map((ex) => {
      const e = ex as Record<string, unknown>;
      return {
        user: String(e.user ?? e.input ?? ''),
        assistant: String(e.assistant ?? e.output ?? e.response ?? ''),
      };
    });
  }

  const card: CharacterCard = {
    name,
    personality,
    scenario: scenario || undefined,
    firstMessage: firstMessage || undefined,
    exampleDialogs: exampleDialogs.length ? exampleDialogs : undefined,
  };

  return {
    name: card.name,
    personality: card.personality,
    scenario: card.scenario,
    firstMessage: card.firstMessage,
    exampleDialogs: card.exampleDialogs,
    avatar: typeof data.avatar === 'string' && data.avatar.trim() && data.avatar !== 'none'
      ? data.avatar.trim()
      : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    systemPrompt: buildPersonaSystemPrompt({
      id: '',
      name: card.name,
      personality: card.personality,
      scenario: card.scenario,
      exampleDialogs: card.exampleDialogs,
      createdAt: '',
      updatedAt: '',
    }),
  };
}

function parseExampleDialogString(text: string): ExampleDialog[] {
  const dialogs: ExampleDialog[] = [];
  const blocks = text.split(/<START>/i).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n').filter(Boolean);
    let user = '';
    let assistant = '';
    for (const line of lines) {
      const userMatch = line.match(/^(?:\{\{user\}\}|User|Human):\s*(.+)/i);
      const assistantMatch = line.match(/^(?:\{\{char\}\}|Assistant|Character):\s*(.+)/i);
      if (userMatch) user = userMatch[1].trim();
      else if (assistantMatch) assistant = assistantMatch[1].trim();
    }
    if (user || assistant) dialogs.push({ user, assistant });
  }

  return dialogs;
}