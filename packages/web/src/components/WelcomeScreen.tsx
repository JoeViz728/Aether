import { useEffect, useState } from 'react';
import { Sparkles, Search, Brain, Hammer, Mic, MessageCircle, ClipboardPaste } from 'lucide-react';
import { AETHER_MODELS } from '@aether/shared';
import type { Persona } from '@aether/shared';
import { api } from '../lib/api';
import { useAppStore } from '../store/app-store';
import { choiceLabel } from '../lib/chat-responder';
import { parseSendTargetValue } from '../lib/send-target';
import { SendTargetSelect } from './SendTargetSelect';

const SUGGESTIONS = [
  { icon: Search, text: 'Research the latest developments in AI' },
  { icon: Brain, text: 'Analyze the trade-offs of microservices vs monolith' },
  { icon: Hammer, text: 'Build a Python script to organize my files' },
  { icon: Mic, text: 'Explain quantum computing in simple terms' },
];

interface Props {
  onSuggestion: (text: string) => void;
  onInitiate: () => void;
  onPasteGreeting: (personaId: string, content: string) => void;
}

export function WelcomeScreen({ onSuggestion, onInitiate, onPasteGreeting }: Props) {
  const storyMode = Boolean(useAppStore((s) => s.activeConversation?.settings.storyMode));
  const activePersonaId = useAppStore((s) => s.activeConversation?.activePersonaId);
  const sendTargetValue = useAppStore((s) => s.sendTargetValue);
  const setSendTarget = useAppStore((s) => s.setSendTarget);
  const personas = useAppStore((s) => s.personas);
  const [localPersonas, setLocalPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    if (personas.length > 0) {
      setLocalPersonas(personas);
      return;
    }
    api.listPersonas().then(setLocalPersonas).catch(() => setLocalPersonas([]));
  }, [personas]);

  const displayPersonas = personas.length > 0 ? personas : localPersonas;
  const availableModels = useAppStore((s) => s.availableModels);
  const modelsForLabel = availableModels.length > 0
    ? availableModels.map((id: string) => ({ id, label: id }))
    : AETHER_MODELS;
  const sendChoice = parseSendTargetValue(sendTargetValue);
  const sendTargetName = choiceLabel(sendChoice, displayPersonas, modelsForLabel);
  const selectedPersona = sendChoice.type === 'persona'
    ? displayPersonas.find((persona) => persona.id === sendChoice.id)
    : null;
  const storyNarrator = storyMode && activePersonaId
    ? displayPersonas.find((persona) => persona.id === activePersonaId)?.name ?? 'Narrator'
    : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-32">
      <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-aether-accent text-aether-bg">
        <Sparkles className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Welcome to Aether</h2>
      <p className="text-aether-muted text-center max-w-md mb-8">
        {storyMode
          ? 'Story mode: configure your narrator and cast, pick who to chat with, then open the scene.'
          : 'Your self-hosted Grok experience. Choose who to chat with, then start the conversation.'}
      </p>

      <div className="w-full max-w-lg mb-6 rounded-xl border border-aether-border bg-aether-surface p-4 space-y-3">
        <label className="block text-sm font-medium">Start chatting with</label>
        <SendTargetSelect
          value={sendTargetValue}
          onChange={(value) => void setSendTarget(value)}
          personas={displayPersonas}
          showPersonas={!storyMode}
        />

        <button
          type="button"
          onClick={onInitiate}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-aether-accent px-4 py-2.5 text-sm font-medium text-aether-bg hover:opacity-90 transition-opacity"
        >
          <MessageCircle className="h-4 w-4" />
          {storyMode
            ? `Open scene${storyNarrator ? ` (${storyNarrator} narrating)` : ''}`
            : `Let ${sendTargetName} speak first`}
        </button>

        {!storyMode && selectedPersona?.firstMessage && (
          <button
            type="button"
            onClick={() => onPasteGreeting(selectedPersona.id, selectedPersona.firstMessage!)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-aether-border px-4 py-2.5 text-sm hover:bg-aether-surface-2 transition-colors"
          >
            <ClipboardPaste className="h-4 w-4" />
            Paste {selectedPersona.name}&apos;s greeting
          </button>
        )}
      </div>

      <div className="grid gap-3 w-full max-w-lg sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onSuggestion(text)}
            className="flex items-start gap-3 rounded-xl border border-aether-border bg-aether-surface p-4 text-left text-sm hover:bg-aether-surface-2 transition-colors"
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-aether-muted" />
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}