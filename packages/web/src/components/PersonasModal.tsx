import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserCircle,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Persona } from '@aether/shared';
import { api } from '../lib/api';
import { useAppStore } from '../store/app-store';
import { PersonaEditorModal } from './PersonaEditorModal';

function personaAvatarSrc(persona: Persona): string | null {
  if (!persona.avatar || persona.avatar === 'none') return null;
  if (persona.avatar.startsWith('/api/')) return persona.avatar;
  return `/api/personas/${persona.id}/avatar`;
}

function PersonaOverflowMenu({
  isOpen,
  onOpen,
  onClose,
  onEdit,
  onDelete,
}: {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  return (
    <div
      className={clsx(
        'relative shrink-0',
        isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      )}
      ref={menuRef}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) onClose();
          else onOpen();
        }}
        className="rounded-lg p-2 text-aether-muted hover:bg-aether-surface-2 hover:text-aether-text transition-colors"
        aria-label="Persona options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[9.5rem] rounded-lg border border-aether-border bg-aether-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onEdit();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-aether-text hover:bg-aether-surface-2 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-aether-surface-2 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function PersonasModal() {
  const { personasOpen, setPersonasOpen, loadPersonas } = useAppStore();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    null | { mode: 'create' } | { mode: 'edit'; persona: Persona }
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPersonas();
      setPersonas(list);
      await loadPersonas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (personasOpen) {
      void load();
      setEditor(null);
      setOpenMenuId(null);
    }
  }, [personasOpen]);

  if (!personasOpen) return null;

  const handleImportFile = async (file: File) => {
    setError(null);
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.png') || file.type === 'image/png') {
        await api.importPersonaFile(file);
      } else {
        const text = await file.text();
        const card = JSON.parse(text);
        await api.importPersona(card);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid character card file');
    }
  };

  const handleDelete = async (persona: Persona) => {
    const confirmed = window.confirm(
      `Delete persona “${persona.name}”? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      setOpenMenuId(null);
      if (editor?.mode === 'edit' && editor.persona.id === persona.id) {
        setEditor(null);
      }
      await api.deletePersona(persona.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete persona');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-aether-overlay"
          onClick={() => setPersonasOpen(false)}
        />
        <div className="relative flex w-full max-w-xl max-h-[90vh] flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
          <div className="flex shrink-0 items-center justify-between border-b border-aether-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Personas</h2>
              <p className="mt-0.5 text-xs text-aether-muted">
                Characters for chat, story cast, and narration. Import SillyTavern-style JSON or PNG
                cards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPersonasOpen(false)}
              className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
              aria-label="Close personas"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-aether-border px-6 py-3">
            <button
              type="button"
              onClick={() => setEditor({ mode: 'create' })}
              className="inline-flex items-center gap-2 rounded-lg bg-aether-accent px-3 py-2 text-sm font-medium text-aether-bg hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New persona
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-aether-border px-3 py-2 text-sm hover:bg-aether-surface-2"
            >
              <Upload className="h-4 w-4" />
              Import card
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.png,application/json,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = '';
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            {loading ? (
              <p className="text-sm text-aether-muted py-8 text-center">Loading personas…</p>
            ) : personas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-aether-border px-4 py-10 text-center">
                <UserCircle className="mx-auto h-8 w-8 text-aether-muted mb-3" />
                <p className="text-sm font-medium">No personas yet</p>
                <p className="mt-1 text-xs text-aether-muted max-w-xs mx-auto leading-relaxed">
                  Create a character card or import a SillyTavern JSON/PNG to get started.
                </p>
                <button
                  type="button"
                  onClick={() => setEditor({ mode: 'create' })}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-aether-border px-3 py-2 text-sm hover:bg-aether-surface-2"
                >
                  <Plus className="h-4 w-4" />
                  Create persona
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {personas.map((persona) => {
                  const avatarSrc = personaAvatarSrc(persona);
                  const capabilityBits: string[] = [];
                  if (persona.model) capabilityBits.push(persona.model);
                  else if (persona.settings?.autoModel) capabilityBits.push('Auto model');
                  if (persona.toolScopes && Object.keys(persona.toolScopes).length > 0) {
                    capabilityBits.push('Notes scope set');
                  }
                  return (
                    <li key={persona.id}>
                      <div
                        className="group flex gap-3 rounded-xl border border-aether-border bg-aether-bg/30 p-3.5 transition-colors hover:bg-aether-bg/60 cursor-pointer"
                        onClick={() => setEditor({ mode: 'edit', persona })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditor({ mode: 'edit', persona });
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-aether-border bg-aether-surface-2">
                          {avatarSrc ? (
                            <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <UserCircle className="h-5 w-5 text-aether-muted" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{persona.name}</div>
                          <p className="mt-0.5 text-xs text-aether-muted line-clamp-2 leading-relaxed">
                            {persona.personality}
                          </p>
                          {persona.scenario && (
                            <p className="mt-1 text-[11px] text-aether-muted line-clamp-1">
                              Scenario: {persona.scenario}
                            </p>
                          )}
                          {capabilityBits.length > 0 && (
                            <p className="mt-1.5 text-[10px] text-aether-muted">
                              {capabilityBits.join(' · ')}
                            </p>
                          )}
                        </div>
                        <PersonaOverflowMenu
                          isOpen={openMenuId === persona.id}
                          onOpen={() => setOpenMenuId(persona.id)}
                          onClose={() => setOpenMenuId(null)}
                          onEdit={() => setEditor({ mode: 'edit', persona })}
                          onDelete={() => void handleDelete(persona)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {editor && (
        <PersonaEditorModal
          mode={editor.mode}
          persona={editor.mode === 'edit' ? editor.persona : null}
          onClose={() => setEditor(null)}
          onSaved={() => load()}
        />
      )}
    </>
  );
}
