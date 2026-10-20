import clsx from 'clsx';
import type { AppSettings } from '@aether/shared';

export type ChatWidth = AppSettings['chatWidth'];

export const CHAT_WIDTH_OPTIONS: { value: ChatWidth; label: string; description: string }[] = [
  { value: 'comfortable', label: 'Comfortable', description: 'Centered column (~768px)' },
  { value: 'wide', label: 'Wide', description: 'Broader column (~1024px)' },
  { value: 'full', label: 'Full width', description: 'Use the full chat area' },
];

export function getMessageBubbleClass(
  role: 'user' | 'assistant',
  settings: Pick<AppSettings, 'bubblePrompts' | 'bubbleResponses'> | null | undefined,
): string {
  const isUser = role === 'user';
  const showBubble = isUser
    ? settings?.bubblePrompts ?? false
    : settings?.bubbleResponses ?? false;

  return clsx(
    'max-w-full rounded-2xl px-4 py-3 text-left text-aether-text',
    isUser ? 'inline-block' : 'block w-full',
    showBubble && 'border border-aether-border bg-transparent',
  );
}

/** Inline compose row stacks when the textarea shrinks below this width. */
export const CHAT_INPUT_MIN_TEXTAREA_WIDTH = 150;

/** Compose row stays stacked until the area is at least this wide. */
export const CHAT_INPUT_COMPOSE_UNSTACK_WIDTH = 400;

export function getMessagePaddingClass(
  role: 'user' | 'assistant',
  settings: Pick<AppSettings, 'mirroredMessagePadding' | 'messagePaddingMobile'> | null | undefined,
): string {
  if (!settings?.mirroredMessagePadding) return '';

  const applyOnMobile = settings.messagePaddingMobile ?? false;
  const prefix = applyOnMobile ? '' : 'md:';
  return role === 'user' ? `${prefix}pl-9` : `${prefix}pr-9`;
}

export function getChatWidthClass(width: ChatWidth | undefined): string {
  switch (width) {
    case 'wide':
      return 'max-w-5xl';
    case 'full':
      return 'max-w-none w-full';
    case 'comfortable':
    default:
      return 'max-w-3xl';
  }
}