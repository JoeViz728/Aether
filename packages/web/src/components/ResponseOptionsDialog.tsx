import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AETHER_MODELS } from '@aether/shared';
import type { Persona, ResponderType } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { api } from '../lib/api';

export interface ResponseOptions {
  influencePrompt?: string;
  respondAs?: { type: ResponderType; id: string };
}

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  confirmingLabel?: string;
  storyMode?: boolean;
  castPersonaIds?: string[];
  onClose: () => void;
  onConfirm: (opts: ResponseOptions) => void | Promise<void>;
}

export function ResponseOptionsDialog({
  title,
  description,
  confirmLabel,
  confirmingLabel = 'Working…',
  storyMode = false,
  castPersonaIds = [],
  onClose,
  onConfirm,
}: Props) {
  const [influencePrompt, setInfluencePrompt] = useState('');
  const [respondAsType, setRespondAsType] = useState<'default' | ResponderType>('default');
  const [respondAsId, setRespondAsId] = useState('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const availableModels = useAppStore((s) => s.availableModels);
  const modelOptions = (availableModels.length > 0
    ? availableModels
    : AETHER_MODELS.map((m) => m.id)
  ).map((id: string) => ({ id, label: id }));

  useEffect(() => {
    api.listPersonas().then(setPersonas).catch(() => setPersonas([]));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onConfirm({
        influencePrompt: influencePrompt.trim() || undefined,
        respondAs: respondAsType === 'default'
          ? undefined
          : { type: respondAsType, id: respondAsId },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-aether-border bg-aether-surface p-6 shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-aether-muted mb-4">{description}</p>

        <label className="block text-sm mb-1.5">Influence prompt (optional)</label>
        <textarea
          value={influencePrompt}
          onChange={(e) => setInfluencePrompt(e.target.value)}
          placeholder="e.g. Be more concise, focus on practical steps…"
          rows={3}
          className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none resize-none mb-4"
        />

        <label className="block text-sm mb-1.5">
          {storyMode ? 'Focus character context (optional)' : 'Respond as'}
        </label>
        <select
          value={respondAsType === 'default' ? 'default' : `${respondAsType}:${respondAsId}`}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'default') {
              setRespondAsType('default');
              setRespondAsId('');
            } else {
              const [type, id] = val.split(':');
              setRespondAsType(type as ResponderType);
              setRespondAsId(id);
            }
          }}
          className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none mb-6"
        >
          <option value="default">
            {storyMode ? 'Narrator default (match cast from prompt)' : 'Conversation default (auto)'}
          </option>
          {!storyMode && (
            <optgroup label="Models">
              {modelOptions.map((m: { id: string; label: string }) => (
                <option key={m.id} value={`model:${m.id}`}>{m.label}</option>
              ))}
            </optgroup>
          )}
          {storyMode ? (
            castPersonaIds.length > 0 ? (
              <optgroup label="Scene cast">
                {personas
                  .filter((p) => castPersonaIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={`persona:${p.id}`}>{p.name}</option>
                  ))}
              </optgroup>
            ) : (
              <option value="default" disabled>No characters in cast — add them in Story panel</option>
            )
          ) : personas.length > 0 ? (
            <optgroup label="Personas">
              {personas.map((p) => (
                <option key={p.id} value={`persona:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-aether-border px-4 py-2.5 text-sm font-medium hover:bg-aether-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-xl bg-aether-accent text-aether-bg px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}