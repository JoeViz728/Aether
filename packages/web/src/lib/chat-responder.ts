import type { ConversationSettings, ResponderType } from '@aether/shared';
import { AUTO_SELECT_LABEL } from './send-target';

export type ChatResponderChoice =
  | { type: 'auto' }
  | { type: 'model'; id: string }
  | { type: 'persona'; id: string };

export function parseResponderSelectValue(value: string): ChatResponderChoice {
  if (value === 'auto' || value === 'default') return { type: 'auto' };
  const colon = value.indexOf(':');
  const type = value.slice(0, colon) as ResponderType | 'auto';
  const id = value.slice(colon + 1);
  if (type === 'model' || type === 'persona') return { type, id };
  return { type: 'auto' };
}

export function responderSelectValue(choice: ChatResponderChoice): string {
  if (choice.type === 'auto') return 'auto';
  return `${choice.type}:${choice.id}`;
}

export function choiceToRequest(choice: ChatResponderChoice): {
  model?: string;
  personaId?: string;
  activePersonaId?: string | null;
  respondAs?: { type: ResponderType; id: string };
  settings?: Partial<ConversationSettings>;
} {
  if (choice.type === 'auto') {
    return { settings: { autoModel: true } };
  }
  if (choice.type === 'model') {
    return {
      model: choice.id,
      activePersonaId: null,
      respondAs: { type: 'model', id: choice.id },
      settings: { autoModel: false },
    };
  }
  return {
    personaId: choice.id,
    activePersonaId: choice.id,
    respondAs: { type: 'persona', id: choice.id },
    settings: { autoModel: false },
  };
}

export function choiceLabel(
  choice: ChatResponderChoice,
  personas: Array<{ id: string; name: string }>,
  models: Array<{ id: string; label: string }>,
): string {
  if (choice.type === 'auto') return AUTO_SELECT_LABEL;
  if (choice.type === 'persona') {
    return personas.find((persona) => persona.id === choice.id)?.name ?? 'Persona';
  }
  if (choice.type === 'model') {
    return models.find((model) => model.id === choice.id)?.label ?? 'Model';
  }
  return AUTO_SELECT_LABEL;
}