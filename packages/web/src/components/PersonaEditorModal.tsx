import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { Persona } from '@aether/shared';
import { api } from '../lib/api';
import { convertImageFileToPng } from '../lib/image-to-png';
import {
  overridesToSettings,
  PersonaSettingsFields,
  personaModelFromFields,
  personaPayloadExtras,
  settingsFormFromPersona,
  type PersonaSettingsFormState,
} from './PersonaSettingsFields';

const fieldClass =
  'w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none focus:border-aether-muted resize-y';

const EMPTY_FORM = {
  name: '',
  personality: '',
  scenario: '',
  firstMessage: '',
};

function personaAvatarSrc(persona: Persona): string | null {
  if (!persona.avatar || persona.avatar === 'none') return null;
  if (persona.avatar.startsWith('/api/')) return persona.avatar;
  return `/api/personas/${persona.id}/avatar`;
}

export interface PersonaEditorModalProps {
  mode: 'create' | 'edit';
  persona?: Persona | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function PersonaEditorModal({ mode, persona, onClose, onSaved }: PersonaEditorModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [settingsForm, setSettingsForm] = useState<PersonaSettingsFormState>(
    settingsFormFromPersona(),
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'edit' && persona) {
      setForm({
        name: persona.name,
        personality: persona.personality,
        scenario: persona.scenario ?? '',
        firstMessage: persona.firstMessage ?? '',
      });
      setSettingsForm(
        settingsFormFromPersona(persona.model, persona.settings, persona.toolScopes),
      );
    } else {
      setForm(EMPTY_FORM);
      setSettingsForm(settingsFormFromPersona());
    }
    setAvatarFile(null);
    setRemoveAvatar(false);
    setError(null);
  }, [mode, persona?.id]);

  useEffect(() => {
    if (avatarFile) {
      const previewUrl = URL.createObjectURL(avatarFile);
      setAvatarPreview(previewUrl);
      return () => URL.revokeObjectURL(previewUrl);
    }
    if (mode === 'edit' && persona && !removeAvatar) {
      setAvatarPreview(personaAvatarSrc(persona));
      return;
    }
    setAvatarPreview(null);
  }, [avatarFile, mode, persona, removeAvatar]);

  const canSave = form.name.trim().length > 0 && form.personality.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        personality: form.personality.trim(),
        scenario: form.scenario.trim() || undefined,
        firstMessage: form.firstMessage.trim() || undefined,
        model: personaModelFromFields(settingsForm.model),
        settings: overridesToSettings(settingsForm),
        ...personaPayloadExtras(settingsForm),
      };
      const avatar = avatarFile ? await convertImageFileToPng(avatarFile) : undefined;

      if (mode === 'edit' && persona) {
        await api.updatePersona(persona.id, payload, avatar, removeAvatar);
      } else {
        await api.createPersona(payload, avatar);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save persona');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={onClose} />
      <div className="relative flex w-full max-w-xl max-h-[90vh] flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex shrink-0 items-center justify-between border-b border-aether-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {mode === 'edit' ? 'Edit persona' : 'New persona'}
            </h2>
            <p className="mt-0.5 text-xs text-aether-muted">
              Character card used as a responder, narrator, or cast member.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
            aria-label="Close editor"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Identity */}
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
                Identity
              </h3>
              <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                Name and look shown in chat. Name and personality are required.
              </p>
            </div>
            <div className="rounded-xl border border-aether-border bg-aether-bg/40 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => avatarRef.current?.click()}
                  className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-aether-border bg-aether-bg hover:border-aether-muted transition-colors"
                  title="Choose avatar image"
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-aether-muted group-hover:text-aether-text" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Avatar</div>
                  <p className="text-xs text-aether-muted leading-relaxed">
                    Optional. Converted to PNG on save.
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => avatarRef.current?.click()}
                      className="text-xs text-aether-muted hover:text-aether-text underline-offset-2 hover:underline"
                    >
                      {avatarPreview ? 'Change image' : 'Add image'}
                    </button>
                    {avatarFile && (
                      <button
                        type="button"
                        onClick={() => setAvatarFile(null)}
                        className="text-xs text-aether-muted hover:text-aether-text underline-offset-2 hover:underline"
                      >
                        Discard new image
                      </button>
                    )}
                    {mode === 'edit' && avatarPreview && !removeAvatar && !avatarFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveAvatar(true);
                          setAvatarFile(null);
                        }}
                        className="text-xs text-aether-muted hover:text-aether-text underline-offset-2 hover:underline"
                      >
                        Remove avatar
                      </button>
                    )}
                  </div>
                </div>
                <input
                  ref={avatarRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setAvatarFile(file);
                      setRemoveAvatar(false);
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Detective Hale"
                  className={fieldClass}
                />
              </div>
            </div>
          </section>

          {/* Character */}
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
                Character
              </h3>
              <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                Personality drives the system prompt. Scenario and first message are optional.
              </p>
            </div>
            <div className="rounded-xl border border-aether-border bg-aether-bg/40 p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Personality</label>
                <p className="text-xs text-aether-muted">
                  Who they are, how they speak, and how they behave.
                </p>
                <textarea
                  value={form.personality}
                  onChange={(e) => setForm({ ...form, personality: e.target.value })}
                  placeholder="Personality, voice, mannerisms…"
                  rows={4}
                  className={fieldClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Scenario</label>
                <p className="text-xs text-aether-muted">Optional setting or world context.</p>
                <textarea
                  value={form.scenario}
                  onChange={(e) => setForm({ ...form, scenario: e.target.value })}
                  placeholder="Where / when this character is…"
                  rows={2}
                  className={fieldClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">First message</label>
                <p className="text-xs text-aether-muted">
                  Optional greeting you can paste from the new-chat screen.
                </p>
                <textarea
                  value={form.firstMessage}
                  onChange={(e) => setForm({ ...form, firstMessage: e.target.value })}
                  placeholder="Opening line…"
                  rows={2}
                  className={fieldClass}
                />
              </div>
            </div>
          </section>

          {/* Model & tools */}
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
                Model &amp; tools
              </h3>
              <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                Overrides applied when this persona is the active responder.
              </p>
            </div>
            <div className="rounded-xl border border-aether-border bg-aether-bg/40 p-4">
              <PersonaSettingsFields value={settingsForm} onChange={setSettingsForm} />
            </div>
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-aether-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-aether-border px-4 py-2 text-sm hover:bg-aether-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="rounded-lg bg-aether-accent px-4 py-2 text-sm font-medium text-aether-bg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create persona'}
          </button>
        </div>
      </div>
    </div>
  );
}
