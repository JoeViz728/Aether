import type { ChatMessage, Persona } from './types.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match for a display name (full name, then first name if long enough). */
export function nameAppearsAsWord(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || !text.trim()) return false;

  const fullPattern = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, 'i');
  if (fullPattern.test(text)) return true;

  const firstName = trimmed.split(/\s+/)[0];
  if (firstName.length >= 3) {
    const firstPattern = new RegExp(`\\b${escapeRegex(firstName)}\\b`, 'i');
    return firstPattern.test(text);
  }

  return false;
}

export function personaNameAppearsInText(text: string, persona: Persona): boolean {
  return nameAppearsAsWord(text, persona.name);
}

/** Relevant only when the user's current message or explicit guidance names the persona. */
export function isUserPersonaRelevant(text: string, persona: Persona): boolean {
  return personaNameAppearsInText(text, persona);
}

export function buildUserPersonaContextBlock(persona: Persona): string {
  const parts: string[] = [
    `The human user is roleplaying as ${persona.name}.`,
    'Use this context for this turn only because they named this character or directed the scene toward them.',
  ];

  if (persona.personality) {
    parts.push(`\n### ${persona.name} — personality\n${persona.personality}`);
  }

  if (persona.scenario) {
    parts.push(`\n### ${persona.name} — background\n${persona.scenario}`);
  }

  return parts.join('\n');
}

export function findRelevantCastPersonas(text: string, cast: Persona[]): Persona[] {
  if (!text.trim() || cast.length === 0) return [];
  return cast.filter((persona) => personaNameAppearsInText(text, persona));
}

const CAST_DISCIPLINE = [
  'This chat has a manually configured scene cast.',
  'Only bring a cast member on stage when the user\'s latest message names them or clearly directs their appearance.',
  'Do not introduce cast members, use their names, or apply their context unprompted.',
].join(' ');

export function buildStoryNarratorSystemPrompt(
  narrator: Persona,
  relevantCast: Persona[],
  userPersona?: Persona | null,
  userPersonaRelevant?: boolean,
): string {
  const parts: string[] = [
    `You are the narrator for this roleplay scene, using the "${narrator.name}" voice.`,
    'Describe the world, stage character actions and dialogue, and advance the scene.',
    'Do not speak for the user. When characters speak, attribute them clearly by name.',
    CAST_DISCIPLINE,
  ];

  if (narrator.personality) {
    parts.push(`\n## Narrator style\n${narrator.personality}`);
  }

  if (narrator.scenario) {
    parts.push(`\n## Scene\n${narrator.scenario}`);
  }

  if (relevantCast.length > 0) {
    parts.push('\n## Active character context (user invoked this turn)');
    for (const character of relevantCast) {
      parts.push(`\n### ${character.name}`);
      if (character.personality) parts.push(character.personality);
      if (character.scenario) {
        parts.push(`Scene notes: ${character.scenario}`);
      }
    }
  }

  if (userPersona && userPersonaRelevant) {
    parts.push('\n## User character context (user invoked this turn)');
    parts.push(buildUserPersonaContextBlock(userPersona));
  }

  return parts.join('\n');
}

export function buildStoryNarratorSystemPromptWithoutPersona(
  relevantCast: Persona[],
  userPersona?: Persona | null,
  userPersonaRelevant?: boolean,
): string {
  const parts: string[] = [
    'You are the narrator for this roleplay scene.',
    'Describe the world, stage character actions and dialogue, and advance the scene.',
    'Do not speak for the user.',
    CAST_DISCIPLINE,
  ];

  if (relevantCast.length > 0) {
    parts.push('\n## Active character context (user invoked this turn)');
    for (const character of relevantCast) {
      parts.push(`\n### ${character.name}`);
      if (character.personality) parts.push(character.personality);
      if (character.scenario) {
        parts.push(`Scene notes: ${character.scenario}`);
      }
    }
  }

  if (userPersona && userPersonaRelevant) {
    parts.push('\n## User character context (user invoked this turn)');
    parts.push(buildUserPersonaContextBlock(userPersona));
  }

  return parts.join('\n');
}

export function formatMessagesForStoryMode(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'user') {
        return { role: 'user' as const, content: message.content };
      }

      const speaker = message.responderName ?? 'Narrator';
      return {
        role: 'assistant' as const,
        content: `[${speaker}]: ${message.content}`,
      };
    });
}

/** Match only the current user turn and optional explicit guidance — not narration history. */
export function collectStoryMatchText(
  promptText: string,
  influencePrompt?: string,
): string {
  const parts = [promptText.trim()];
  if (influencePrompt?.trim()) parts.push(influencePrompt.trim());
  return parts.filter(Boolean).join('\n');
}