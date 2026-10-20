import type { AppSettings, Conversation } from '@aether/shared';
import type { ChatResponderChoice } from './chat-responder';

export const SEND_TARGET_AUTO = 'auto';
export const AUTO_SELECT_LABEL = '(Auto)';

export function parseSendTargetValue(value: string): ChatResponderChoice {
  if (value === SEND_TARGET_AUTO || value === 'default') return { type: 'auto' };
  if (value.startsWith('model:')) return { type: 'model', id: value.slice(6) };
  if (value.startsWith('persona:')) return { type: 'persona', id: value.slice(8) };
  return { type: 'auto' };
}

export function sendTargetValueFromChoice(choice: ChatResponderChoice): string {
  if (choice.type === 'auto') return SEND_TARGET_AUTO;
  return `${choice.type}:${choice.id}`;
}

export function sendTargetValueFromSettings(settings: AppSettings): string {
  return settings.autoModelRouting ? SEND_TARGET_AUTO : `model:${settings.defaultModel}`;
}

export function sendTargetValueFromConversation(
  conversation: Conversation,
  storyMode: boolean,
): string {
  if (!storyMode && conversation.activePersonaId) {
    return `persona:${conversation.activePersonaId}`;
  }
  if (conversation.settings.autoModel) return SEND_TARGET_AUTO;
  return `model:${conversation.model}`;
}

export function applySendTargetToConversation(
  conversation: Conversation,
  value: string,
  settings: AppSettings | null,
  personas: Array<{ id: string; model?: string }>,
  storyMode: boolean,
): Conversation {
  const choice = parseSendTargetValue(value);
  const fallbackModel = settings?.defaultModel ?? conversation.model;

  if (choice.type === 'auto') {
    return {
      ...conversation,
      model: fallbackModel,
      activePersonaId: storyMode ? conversation.activePersonaId : undefined,
      settings: { ...conversation.settings, autoModel: true },
    };
  }

  if (choice.type === 'model') {
    return {
      ...conversation,
      model: choice.id,
      activePersonaId: storyMode ? conversation.activePersonaId : undefined,
      settings: { ...conversation.settings, autoModel: false },
    };
  }

  if (storyMode) {
    const persona = personas.find((entry) => entry.id === choice.id);
    return {
      ...conversation,
      model: persona?.model ?? fallbackModel,
      settings: { ...conversation.settings, autoModel: false },
    };
  }

  const persona = personas.find((entry) => entry.id === choice.id);
  return {
    ...conversation,
    activePersonaId: choice.id,
    model: persona?.model ?? fallbackModel,
    settings: { ...conversation.settings, autoModel: false },
  };
}

export function settingsFromSendTargetValue(
  value: string,
  current: AppSettings,
): Pick<AppSettings, 'defaultModel' | 'autoModelRouting'> {
  if (value === SEND_TARGET_AUTO) {
    return { autoModelRouting: true, defaultModel: current.defaultModel };
  }
  const modelId = value.startsWith('model:') ? value.slice(6) : current.defaultModel;
  return { autoModelRouting: false, defaultModel: modelId };
}