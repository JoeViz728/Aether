import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Settings2, X } from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, NotesScopeSource, Persona, ToolScopeConfig } from '@aether/shared';
import {
  NOTES_ACCESS_LABELS,
  NOTES_SCOPE_SOURCE_LABELS,
  NOTES_TOOL_ID,
} from '@aether/shared';
import { api } from '../lib/api';
import {
  ToolScopeFields,
  toolScopeFormFromConfig,
  toolScopeFormToConfig,
  type ToolScopeFormState,
} from './ToolScopeFields';

interface Props {
  conversation: Conversation | null;
  onUpdate: (patch: Partial<Conversation>) => Promise<void>;
  disabled?: boolean;
}

export function ConversationSettingsPanel({ conversation, onUpdate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [addPersonaId, setAddPersonaId] = useState('');
  const [form, setForm] = useState<ToolScopeFormState>(toolScopeFormFromConfig(null));
  const [effective, setEffective] = useState<ToolScopeConfig | null>(null);
  const [source, setSource] = useState<NotesScopeSource | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const storyMode = Boolean(conversation?.settings.storyMode);
  const override = conversation?.settings.toolScopes?.[NOTES_TOOL_ID] ?? null;
  const castIds = conversation?.storyCastPersonaIds ?? [];
  const castPersonas = castIds
    .map((id) => personas.find((p) => p.id === id))
    .filter((p): p is Persona => Boolean(p));
  const availableToAdd = personas.filter(
    (p) => !castIds.includes(p.id) && p.id !== conversation?.userPersonaId,
  );

  useEffect(() => {
    api.listPersonas().then(setPersonas).catch(() => setPersonas([]));
  }, []);

  useEffect(() => {
    if (!open || !conversation) return;
    setForm(toolScopeFormFromConfig(override));
    void api
      .getNotesScope({
        conversationId: conversation.id || undefined,
        personaId: conversation.activePersonaId,
      })
      .then((res) => {
        setEffective(res.effective);
        setSource(res.source ?? null);
      })
      .catch(() => {
        setEffective(null);
        setSource(null);
      });
  }, [
    open,
    conversation?.id,
    conversation?.activePersonaId,
    conversation?.settings.storyMode,
    override,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggleStoryMode = async () => {
    if (!conversation) return;
    await onUpdate({
      settings: { ...conversation.settings, storyMode: !storyMode },
    });
  };

  const setNarrator = async (personaId: string) => {
    if (!conversation) return;
    await onUpdate({
      activePersonaId: personaId || undefined,
    });
  };

  const setUserPersona = async (personaId: string) => {
    if (!conversation) return;
    await onUpdate({
      userPersonaId: personaId || undefined,
    });
  };

  const addToCast = async () => {
    if (!conversation || !addPersonaId) return;
    const nextCast = [...castIds, addPersonaId];
    setAddPersonaId('');
    await onUpdate({ storyCastPersonaIds: nextCast });
  };

  const removeFromCast = async (personaId: string) => {
    if (!conversation) return;
    await onUpdate({
      storyCastPersonaIds: castIds.filter((id) => id !== personaId),
    });
  };

  /**
   * Draft chats (no server id yet): only update local settings — materialize
   * copies draft.settings (including toolScopes) when the chat is created.
   * Persisted chats: also hit the notes scope API for consistency.
   */
  const applyScopeForm = async (next: ToolScopeFormState) => {
    if (!conversation) return;
    setForm(next);
    setSaving(true);
    try {
      const config = toolScopeFormToConfig(next);
      const nextToolScopes = { ...conversation.settings.toolScopes };
      if (!config) {
        delete nextToolScopes[NOTES_TOOL_ID];
      } else {
        nextToolScopes[NOTES_TOOL_ID] = config;
      }
      const settings = {
        ...conversation.settings,
        toolScopes: Object.keys(nextToolScopes).length ? nextToolScopes : undefined,
      };

      if (conversation.id) {
        if (!config) {
          await api.setConversationNotesScope(conversation.id, { clear: true });
        } else {
          await api.setConversationNotesScope(conversation.id, config);
        }
      }

      await onUpdate({ settings });

      const res = await api.getNotesScope({
        conversationId: conversation.id || undefined,
        personaId: conversation.activePersonaId,
      });
      setEffective(res.effective);
      setSource(res.source ?? null);
    } catch {
      /* keep form */
    } finally {
      setSaving(false);
    }
  };

  const hasOverride = Boolean(override);
  const accentActive = storyMode || hasOverride;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !conversation}
        title="Conversation settings"
        aria-label="Conversation settings"
        aria-expanded={open}
        className={clsx(
          'rounded-lg p-2 text-aether-muted transition-colors hover:bg-aether-surface-2 hover:text-aether-text',
          open && 'bg-aether-surface-2 text-aether-text',
          accentActive && !open && 'text-aether-tool-active',
          (disabled || !conversation) && 'cursor-not-allowed opacity-50',
        )}
      >
        {storyMode ? <BookOpen className="h-5 w-5" /> : <Settings2 className="h-5 w-5" />}
      </button>

      {open && conversation && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[22rem] rounded-xl border border-aether-border bg-aether-surface p-4 shadow-2xl animate-fade-in max-h-[min(80vh,560px)] overflow-y-auto">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Conversation settings</h3>
            <p className="mt-1 text-xs text-aether-muted leading-relaxed">
              Story mode, cast, and what the model may access in Linked Notes for this chat.
            </p>
          </div>

          {/* ── Story ─────────────────────────────────────────── */}
          <section className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-aether-muted" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
                Story
              </h4>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-aether-muted mb-1.5">
                You play as
              </label>
              <select
                value={conversation.userPersonaId ?? ''}
                onChange={(e) => void setUserPersona(e.target.value)}
                className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none"
              >
                <option value="">Yourself (shown as &quot;You&quot;)</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-aether-muted leading-relaxed">
                Your messages use this name. Personality context injects when you name this character.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={storyMode}
                onChange={() => void toggleStoryMode()}
                className="rounded"
              />
              Enable story mode for this chat
            </label>

            {storyMode && (
              <div className="space-y-3 border-t border-aether-border pt-3">
                <div>
                  <label className="block text-xs font-medium text-aether-muted mb-1.5">
                    Narrator persona
                  </label>
                  <select
                    value={conversation.activePersonaId ?? ''}
                    onChange={(e) => void setNarrator(e.target.value)}
                    className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">Default narrator voice</option>
                    {personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {persona.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-aether-muted mb-1.5">
                    Scene cast
                  </label>
                  <p className="text-[11px] text-aether-muted mb-2 leading-relaxed">
                    Characters whose context can load when you name them. Not revealed until then.
                  </p>

                  {castPersonas.length > 0 ? (
                    <ul className="space-y-1.5 mb-3">
                      {castPersonas.map((persona) => (
                        <li
                          key={persona.id}
                          className="flex items-center justify-between rounded-lg border border-aether-border bg-aether-bg px-2.5 py-1.5 text-sm"
                        >
                          <span className="truncate">{persona.name}</span>
                          <button
                            type="button"
                            onClick={() => void removeFromCast(persona.id)}
                            className="rounded p-1 text-aether-muted hover:text-red-400"
                            title={`Remove ${persona.name} from cast`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-aether-muted italic mb-3">No characters in cast yet.</p>
                  )}

                  {availableToAdd.length > 0 ? (
                    <div className="flex gap-2">
                      <select
                        value={addPersonaId}
                        onChange={(e) => setAddPersonaId(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none"
                      >
                        <option value="">Add character…</option>
                        {availableToAdd.map((persona) => (
                          <option key={persona.id} value={persona.id}>
                            {persona.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void addToCast()}
                        disabled={!addPersonaId}
                        className="shrink-0 rounded-lg border border-aether-border px-2.5 py-2 text-aether-muted hover:text-aether-text hover:bg-aether-surface-2 disabled:opacity-50"
                        title="Add to cast"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : personas.length === 0 ? (
                    <p className="text-xs text-aether-muted">Create personas to add them to the cast.</p>
                  ) : (
                    <p className="text-xs text-aether-muted">All personas are already in the cast.</p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Linked Notes scope ────────────────────────────── */}
          <section className="border-t border-aether-border pt-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-aether-muted" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
                Linked Notes access
              </h4>
            </div>
            <p className="text-[11px] text-aether-muted mb-3 leading-relaxed">
              What the model may use in this chat. You always have full access in Tools.
              {!conversation.id && (
                <>
                  {' '}
                  Changes here apply when you start the conversation.
                </>
              )}
            </p>

            {effective && (
              <div className="mb-3 rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-xs">
                <div className="text-aether-muted">Effective model access</div>
                <div className="font-medium mt-0.5">{NOTES_ACCESS_LABELS[effective.access]}</div>
                {source && (
                  <div className="text-[10px] text-aether-muted mt-1">
                    Source: {NOTES_SCOPE_SOURCE_LABELS[source]}
                    {storyMode ? ' · Story mode on' : ''}
                    {conversation.activePersonaId ? ' · Persona active' : ''}
                  </div>
                )}
              </div>
            )}

            <ToolScopeFields
              value={form}
              onChange={(v) => void applyScopeForm(v)}
              allowInherit
              inheritLabel="Inherit (app / persona / story defaults)"
              title=""
              description="Isolate this chat, open the root library, or turn notes off for the model."
              compact
            />
            {saving && <p className="mt-2 text-[10px] text-aether-muted">Saving…</p>}
          </section>
        </div>
      )}
    </div>
  );
}
