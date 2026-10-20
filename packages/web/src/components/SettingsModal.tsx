import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Upload, X } from 'lucide-react';
import type { NotesScopeDefaults, ToolResourceAccess, ToolScopeConfig } from '@aether/shared';
import { DEFAULT_NOTES_SCOPE_DEFAULTS, mergeNotesScopeDefaults } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { SendTargetSelect } from './SendTargetSelect';
import {
  sendTargetValueFromSettings,
  settingsFromSendTargetValue,
} from '../lib/send-target';
import { api } from '../lib/api';
import { CHAT_WIDTH_OPTIONS } from '../lib/chat-layout';
import { isSimulateOffline, setSimulateOffline } from '../lib/offline-debug';
import { NotesAccessSelect } from './ToolScopeFields';
import { ImportConversationsModal } from './ImportConversationsModal';

const FALLBACK_VOICES = [
  { voice_id: 'eve', name: 'Eve' },
  { voice_id: 'ara', name: 'Ara' },
  { voice_id: 'rex', name: 'Rex' },
  { voice_id: 'sal', name: 'Sal' },
  { voice_id: 'leo', name: 'Leo' },
];

const fieldClass =
  'w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none focus:border-aether-muted disabled:opacity-50';

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-aether-muted">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-xs text-aether-muted leading-relaxed">{description}</p>
        )}
      </div>
      <div className="rounded-xl border border-aether-border bg-aether-bg/40 p-4 space-y-4">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-aether-text">{label}</div>
      {hint && <p className="text-xs text-aether-muted leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 rounded"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-aether-text">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-aether-muted leading-relaxed">{hint}</span>
        )}
      </span>
    </label>
  );
}

function ToggleGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

export function SettingsModal() {
  const {
    settingsOpen,
    settings,
    apiKeyConfigured,
    updateSettings,
    setSettingsOpen,
    initialize,
    refreshModels,
    availableModels,
    loadConversations,
  } = useAppStore();
  const [voices, setVoices] = useState(FALLBACK_VOICES);
  const [simulateOffline, setSimulateOfflineState] = useState(isSimulateOffline());
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelsRefreshMsg, setModelsRefreshMsg] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    api
      .listVoices()
      .then((res) => setVoices(res.voices.length ? res.voices : FALLBACK_VOICES))
      .catch(() => setVoices(FALLBACK_VOICES));

    if (useAppStore.getState().availableModels.length === 0) {
      void useAppStore.getState().loadModels();
    }
  }, [settingsOpen]);

  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    setModelsRefreshMsg(null);
    try {
      await refreshModels();
      const count = useAppStore.getState().availableModels.length;
      setModelsRefreshMsg(
        count > 0 ? `Loaded ${count} models` : 'No models returned (check API key)',
      );
      setTimeout(() => setModelsRefreshMsg(null), 2200);
    } catch {
      setModelsRefreshMsg('Refresh failed');
      setTimeout(() => setModelsRefreshMsg(null), 2200);
    } finally {
      setRefreshingModels(false);
    }
  };

  if (!settingsOpen || !settings) return null;

  const notesDefaults = mergeNotesScopeDefaults(settings.notesScopeDefaults);
  const ttsOn = settings.voice.ttsEnabled;
  const sttOn = settings.voice.sttEnabled;

  const patchNotesDefault = (
    key: keyof NotesScopeDefaults,
    access: ToolResourceAccess,
  ) => {
    const row: ToolScopeConfig = {
      ...notesDefaults[key],
      access,
      allowMoveToRoot: notesDefaults[key].allowMoveToRoot ?? true,
      allowMoveFromRoot: notesDefaults[key].allowMoveFromRoot ?? false,
    };
    void updateSettings({
      notesScopeDefaults: { ...notesDefaults, [key]: row },
    });
  };

  const patchNotesMove = (
    key: keyof NotesScopeDefaults,
    field: 'allowMoveToRoot' | 'allowMoveFromRoot',
    value: boolean,
  ) => {
    void updateSettings({
      notesScopeDefaults: {
        ...notesDefaults,
        [key]: { ...notesDefaults[key], [field]: value },
      },
    });
  };

  const notesRows: Array<{
    key: keyof NotesScopeDefaults;
    label: string;
    hint: string;
  }> = [
    {
      key: 'bareModel',
      label: 'Bare model',
      hint: 'No persona, story mode off — default for plain chats.',
    },
    {
      key: 'withPersona',
      label: 'With persona',
      hint: 'Active persona without its own notes override.',
    },
    {
      key: 'storyMode',
      label: 'Story mode',
      hint: 'Story mode on, unless the chat sets its own override.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" onClick={() => setSettingsOpen(false)} />
      <div className="relative flex w-full max-w-xl max-h-[90vh] flex-col rounded-2xl border border-aether-border bg-aether-surface shadow-2xl animate-fade-in">
        <div className="flex shrink-0 items-center justify-between border-b border-aether-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Settings</h2>
            <p className="mt-0.5 text-xs text-aether-muted">
              App-wide defaults. Per-chat options live in Conversation settings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded-lg p-1.5 text-aether-muted hover:text-aether-text"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* ── Connection ─────────────────────────────────────── */}
          <SettingsSection
            title="Connection"
            description="How Aether reaches xAI. The API key is read from your environment file."
          >
            <div
              className={`rounded-lg border px-3 py-2.5 text-sm ${
                apiKeyConfigured
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              }`}
            >
              {apiKeyConfigured ? (
                <span>xAI API key configured</span>
              ) : (
                <span>
                  No API key detected. Set <code className="text-amber-100">XAI_API_KEY</code> in{' '}
                  <code className="text-amber-100">.env</code> at the project root, then restart the
                  server.
                </span>
              )}
            </div>
          </SettingsSection>

          {/* ── Models ─────────────────────────────────────────── */}
          <SettingsSection
            title="Models"
            description="Default responder for new chats and the live model list from xAI."
          >
            <Field
              label="Default send target"
              hint="Used when you open a new chat. Auto-select routes by task type (build, fast, general). You can still change the target per message."
            >
              <SendTargetSelect
                value={sendTargetValueFromSettings(settings)}
                onChange={(value) => updateSettings(settingsFromSendTargetValue(value, settings))}
                showPersonas={false}
              />
            </Field>

            <Field
              label="Available models"
              hint="Pulled from the xAI models API. Refresh after adding access to new models on your account."
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRefreshModels()}
                  disabled={refreshingModels}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-aether-border bg-aether-surface px-3 py-1.5 text-xs font-medium hover:bg-aether-surface-2 disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshingModels ? 'animate-spin' : ''}`}
                  />
                  {refreshingModels ? 'Refreshing…' : 'Refresh list'}
                </button>
                <span className="text-xs text-aether-muted tabular-nums">
                  {availableModels.length > 0
                    ? `${availableModels.length} model${availableModels.length === 1 ? '' : 's'}`
                    : 'None loaded yet'}
                </span>
              </div>
              {modelsRefreshMsg && (
                <p className="mt-1.5 text-[11px] text-aether-muted">{modelsRefreshMsg}</p>
              )}
              {availableModels.length > 0 && (
                <p className="mt-2 max-h-20 overflow-y-auto text-[11px] leading-relaxed text-aether-muted break-all">
                  {availableModels.join(' · ')}
                </p>
              )}
            </Field>
          </SettingsSection>

          {/* ── Appearance ─────────────────────────────────────── */}
          <SettingsSection
            title="Appearance"
            description="Theme and how messages are laid out in the chat column."
          >
            <Field label="Theme" hint="System follows your OS light/dark preference.">
              <select
                value={settings.theme}
                onChange={(e) =>
                  updateSettings({ theme: e.target.value as typeof settings.theme })
                }
                className={fieldClass}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>

            <Field
              label="Chat width"
              hint="Width of the message column inside the main chat area."
            >
              <select
                value={settings.chatWidth ?? 'comfortable'}
                onChange={(e) =>
                  updateSettings({ chatWidth: e.target.value as typeof settings.chatWidth })
                }
                className={fieldClass}
              >
                {CHAT_WIDTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} — {option.description}
                  </option>
                ))}
              </select>
            </Field>

            <div className="space-y-2">
              <div className="text-sm font-medium">Message chrome</div>
              <p className="text-xs text-aether-muted leading-relaxed">
                Optional outlines and side padding so prompts and replies read more like bubbles.
              </p>
              <ToggleGroup>
                <ToggleRow
                  label="Outline on responses"
                  hint="Border around assistant messages."
                  checked={settings.bubbleResponses ?? false}
                  onChange={(checked) => updateSettings({ bubbleResponses: checked })}
                />
                <ToggleRow
                  label="Outline on prompts"
                  hint="Border around your messages."
                  checked={settings.bubblePrompts ?? false}
                  onChange={(checked) => updateSettings({ bubblePrompts: checked })}
                />
                <ToggleRow
                  label="Mirrored far-side padding"
                  hint="Extra space on the outer edge of each message (right for replies, left for prompts)."
                  checked={settings.mirroredMessagePadding ?? false}
                  onChange={(checked) => updateSettings({ mirroredMessagePadding: checked })}
                />
                <ToggleRow
                  label="Padding on mobile"
                  hint="Apply mirrored padding on small screens too. Only matters when mirrored padding is on."
                  checked={settings.messagePaddingMobile ?? false}
                  onChange={(checked) => updateSettings({ messagePaddingMobile: checked })}
                  disabled={!settings.mirroredMessagePadding}
                />
              </ToggleGroup>
            </div>
          </SettingsSection>

          {/* ── Voice ──────────────────────────────────────────── */}
          <SettingsSection
            title="Voice"
            description="Text-to-speech playback and speech-to-text dictation."
          >
            <div className="space-y-3">
              <div className="text-sm font-medium">Speech output (TTS)</div>
              <ToggleGroup>
                <ToggleRow
                  label="Enable text-to-speech"
                  hint="Allows reading assistant messages aloud from the playback bar."
                  checked={ttsOn}
                  onChange={(checked) =>
                    updateSettings({ voice: { ...settings.voice, ttsEnabled: checked } })
                  }
                />
                <ToggleRow
                  label="Auto-read responses"
                  hint="Start speaking when a reply finishes generating."
                  checked={settings.voice.autoReadResponses}
                  onChange={(checked) =>
                    updateSettings({ voice: { ...settings.voice, autoReadResponses: checked } })
                  }
                  disabled={!ttsOn}
                />
              </ToggleGroup>

              <Field label="Voice" hint="xAI voice used for synthesis.">
                <select
                  value={settings.voice.ttsVoice}
                  onChange={(e) =>
                    updateSettings({ voice: { ...settings.voice, ttsVoice: e.target.value } })
                  }
                  disabled={!ttsOn}
                  className={fieldClass}
                >
                  {voices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Prefetch ahead"
                  hint="How many upcoming paragraphs to buffer while playing (0–10)."
                >
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={settings.voice.ttsPrefetchAhead ?? 2}
                    disabled={!ttsOn}
                    onChange={(e) =>
                      updateSettings({
                        voice: {
                          ...settings.voice,
                          ttsPrefetchAhead: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                        },
                      })
                    }
                    className={fieldClass}
                  />
                </Field>
                <Field
                  label="Split threshold"
                  hint="Messages with fewer paragraphs than this play as one clip (1–20)."
                >
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.voice.ttsMinParagraphs ?? 3}
                    disabled={!ttsOn}
                    onChange={(e) =>
                      updateSettings({
                        voice: {
                          ...settings.voice,
                          ttsMinParagraphs: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                        },
                      })
                    }
                    className={fieldClass}
                  />
                </Field>
              </div>
            </div>

            <div className="border-t border-aether-border pt-4 space-y-3">
              <div className="text-sm font-medium">Speech input (STT)</div>
              <ToggleGroup>
                <ToggleRow
                  label="Enable speech-to-text"
                  hint="Show the microphone control on the compose bar (browser STT)."
                  checked={sttOn}
                  onChange={(checked) =>
                    updateSettings({ voice: { ...settings.voice, sttEnabled: checked } })
                  }
                />
                <ToggleRow
                  label="Dictation on new chats"
                  hint="Start listening automatically on an empty chat when STT is enabled."
                  checked={settings.voice.dictationOnNewChat}
                  onChange={(checked) =>
                    updateSettings({ voice: { ...settings.voice, dictationOnNewChat: checked } })
                  }
                  disabled={!sttOn}
                />
              </ToggleGroup>
            </div>
          </SettingsSection>

          {/* ── Tools ──────────────────────────────────────────── */}
          <SettingsSection
            title="Tools & automation"
            description="Defaults for Linked Notes model access and approval shortcuts for builds."
          >
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">Linked Notes — model defaults</div>
                <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                  Applied when a chat has not set its own override. Persona and story mode use their
                  rows below; individual chats and personas can still override in their settings.
                  You always have full access in Tools &amp; Automation.
                </p>
              </div>

              <div className="space-y-3">
                {notesRows.map(({ key, label, hint }) => {
                  const row = notesDefaults[key];
                  const access = row.access;
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-aether-border bg-aether-surface/60 p-3 space-y-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        <p className="mt-0.5 text-[11px] text-aether-muted leading-relaxed">
                          {hint}
                        </p>
                      </div>
                      <NotesAccessSelect
                        value={access}
                        onChange={(next) => patchNotesDefault(key, next)}
                      />
                      {access !== 'none' && (
                        <ToggleGroup>
                          <ToggleRow
                            label="Model may move chat notes → root"
                            hint="Graduate case notes into the shared library."
                            checked={row.allowMoveToRoot ?? row.allowPromoteToRoot ?? true}
                            onChange={(checked) => patchNotesMove(key, 'allowMoveToRoot', checked)}
                          />
                          <ToggleRow
                            label="Model may move root notes → chat"
                            hint="Pull library items into the active case file."
                            checked={row.allowMoveFromRoot ?? false}
                            onChange={(checked) =>
                              patchNotesMove(key, 'allowMoveFromRoot', checked)
                            }
                          />
                        </ToggleGroup>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="text-xs text-aether-muted underline-offset-2 hover:text-aether-text hover:underline"
                onClick={() =>
                  void updateSettings({
                    notesScopeDefaults: { ...DEFAULT_NOTES_SCOPE_DEFAULTS },
                  })
                }
              >
                Reset notes defaults to recommended
              </button>
            </div>

            <div className="border-t border-aether-border pt-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Approvals</div>
                <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                  Skip confirmation dialogs for structural build or script actions. Leave off if you
                  want to review each request.
                </p>
              </div>
              <ToggleGroup>
                <ToggleRow
                  label="Always approve builds"
                  hint="Auto-approve aether build / tool-scaffold requests."
                  checked={settings.alwaysApproveBuilds}
                  onChange={(checked) => updateSettings({ alwaysApproveBuilds: checked })}
                />
                <ToggleRow
                  label="Always approve scripts"
                  hint="Auto-approve script execution requests."
                  checked={settings.alwaysApproveScripts}
                  onChange={(checked) => updateSettings({ alwaysApproveScripts: checked })}
                />
              </ToggleGroup>
            </div>
          </SettingsSection>

          {/* ── Data ───────────────────────────────────────────── */}
          <SettingsSection
            title="Data"
            description="Bring chats into Aether from external exports. Runtime data still lives in your local data folder."
          >
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">Import conversations</div>
                <p className="mt-1 text-xs text-aether-muted leading-relaxed">
                  Supports <strong className="font-medium text-aether-text/90">xAI / Grok data exports</strong>
                  {' '}(.zip from your account download, or the{' '}
                  <code className="text-[11px]">prod-grok-backend.json</code> inside it). You&apos;ll
                  preview and choose which chats to bring in before anything is saved.
                </p>
                <p className="mt-1.5 text-xs text-aether-muted leading-relaxed">
                  Aether native export/import is planned next — this path is for xAI packages only
                  for now.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => importRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-aether-border bg-aether-surface px-3 py-2 text-xs font-medium hover:bg-aether-surface-2"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Choose export file…
                </button>
                <span className="text-[11px] text-aether-muted">.zip or .json · up to ~120&nbsp;MB</span>
              </div>

              <input
                ref={importRef}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImportMsg(null);
                    setImportFile(file);
                  }
                  e.target.value = '';
                }}
              />

              {importMsg && (
                <p className="text-xs text-emerald-300/90 leading-relaxed">{importMsg}</p>
              )}
            </div>
          </SettingsSection>

          {/* ── Developer ──────────────────────────────────────── */}
          <SettingsSection
            title="Developer"
            description="Diagnostics for local development. Not required for normal use."
          >
            <ToggleRow
              label="Simulate offline mode"
              hint="Blocks network requests and uses cached chats and settings in this browser. Useful for testing the offline queue."
              checked={simulateOffline}
              onChange={(enabled) => {
                setSimulateOffline(enabled);
                setSimulateOfflineState(enabled);
                void initialize();
              }}
            />
          </SettingsSection>
        </div>
      </div>

      {importFile && (
        <ImportConversationsModal
          file={importFile}
          onClose={() => setImportFile(null)}
          onImported={(count) => {
            void loadConversations();
            setImportMsg(
              count === 0
                ? 'No conversations were imported.'
                : `Imported ${count} conversation${count === 1 ? '' : 's'}.`,
            );
          }}
        />
      )}
    </div>
  );
}
