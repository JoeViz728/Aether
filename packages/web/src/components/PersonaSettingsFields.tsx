import { AETHER_MODELS, NOTES_TOOL_ID } from '@aether/shared';
import type { ConversationSettings, Persona, ToolScopeConfig } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { AUTO_SELECT_LABEL } from '../lib/send-target';
import {
  ToolScopeFields,
  toolScopeFormFromConfig,
  toolScopeFormToConfig,
  type ToolScopeFormState,
} from './ToolScopeFields';

export type SettingOverride = 'inherit' | 'on' | 'off';

/** Persona model field: inherit | auto | concrete model id */
export type PersonaModelChoice = '' | 'auto' | string;

export interface PersonaSettingsFormState {
  model: PersonaModelChoice;
  enableWebSearch: SettingOverride;
  enableXSearch: SettingOverride;
  enableCodeExecution: SettingOverride;
  enableMultiAgent: SettingOverride;
  notesScope: ToolScopeFormState;
}

const CAPABILITY_FIELDS: Array<{
  key: keyof Pick<
    ConversationSettings,
    'enableWebSearch' | 'enableXSearch' | 'enableCodeExecution' | 'enableMultiAgent'
  >;
  label: string;
  hint: string;
}> = [
  {
    key: 'enableWebSearch',
    label: 'Web search',
    hint: 'Allow live web search while this persona responds.',
  },
  {
    key: 'enableXSearch',
    label: 'X search',
    hint: 'Allow searching X (Twitter) posts.',
  },
  {
    key: 'enableCodeExecution',
    label: 'Code execution',
    hint: 'Allow the code interpreter for calculations and scripts.',
  },
  {
    key: 'enableMultiAgent',
    label: 'Multi-agent',
    hint: 'Allow multi-agent routing when auto-select is on.',
  },
];

const fieldClass =
  'w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none focus:border-aether-muted';

export function settingToOverride(value: boolean | undefined): SettingOverride {
  if (value === undefined) return 'inherit';
  return value ? 'on' : 'off';
}

export function overridesToSettings(
  form: PersonaSettingsFormState,
): Partial<ConversationSettings> | undefined {
  const settings: Partial<ConversationSettings> = {};
  for (const { key } of CAPABILITY_FIELDS) {
    const value = overrideToSetting(form[key]);
    if (value !== undefined) settings[key] = value;
  }
  if (form.model === 'auto') {
    settings.autoModel = true;
  } else if (form.model) {
    settings.autoModel = false;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export function notesScopeFromForm(form: PersonaSettingsFormState): Record<string, ToolScopeConfig> {
  const config = toolScopeFormToConfig(form.notesScope);
  if (!config) return {};
  return { [NOTES_TOOL_ID]: config };
}

/** Always include toolScopes so inherit clears a previous persona override. */
export function personaPayloadExtras(form: PersonaSettingsFormState): Pick<Persona, 'toolScopes'> {
  return { toolScopes: notesScopeFromForm(form) };
}

export function overrideToSetting(value: SettingOverride): boolean | undefined {
  if (value === 'inherit') return undefined;
  return value === 'on';
}

export function personaModelFromFields(model: PersonaModelChoice): string | undefined {
  if (!model || model === 'auto') return undefined;
  return model;
}

export function settingsFormFromPersona(
  model?: string,
  settings?: Partial<ConversationSettings>,
  toolScopes?: Persona['toolScopes'],
): PersonaSettingsFormState {
  let modelChoice: PersonaModelChoice = '';
  if (model) {
    modelChoice = model;
  } else if (settings?.autoModel === true) {
    modelChoice = 'auto';
  }

  return {
    model: modelChoice,
    enableWebSearch: settingToOverride(settings?.enableWebSearch),
    enableXSearch: settingToOverride(settings?.enableXSearch),
    enableCodeExecution: settingToOverride(settings?.enableCodeExecution),
    enableMultiAgent: settingToOverride(settings?.enableMultiAgent),
    notesScope: toolScopeFormFromConfig(toolScopes?.[NOTES_TOOL_ID] ?? null),
  };
}

interface Props {
  value: PersonaSettingsFormState;
  onChange: (value: PersonaSettingsFormState) => void;
}

export function PersonaSettingsFields({ value, onChange }: Props) {
  const availableModels = useAppStore((s) => s.availableModels);
  const modelOptions = (
    availableModels.length > 0 ? availableModels : AETHER_MODELS.map((m) => m.id)
  ).map((id: string) => ({ id, label: id }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Preferred model</div>
        <p className="text-xs text-aether-muted leading-relaxed">
          Used when this persona is the active responder. Inherit keeps the conversation default.
        </p>
        <select
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value as PersonaModelChoice })}
          className={fieldClass}
        >
          <option value="">Inherit from conversation</option>
          <option value="auto">{AUTO_SELECT_LABEL}</option>
          {modelOptions.map((model: { id: string; label: string }) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Tool capabilities</div>
        <p className="text-xs text-aether-muted leading-relaxed">
          Optional overrides while this persona is active. Default inherits the conversation.
        </p>
        <div className="space-y-2">
          {CAPABILITY_FIELDS.map(({ key, label, hint }) => (
            <div
              key={key}
              className="flex items-start justify-between gap-3 rounded-lg border border-aether-border bg-aether-bg/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm">{label}</div>
                <p className="mt-0.5 text-[11px] text-aether-muted leading-relaxed">{hint}</p>
              </div>
              <select
                value={value[key]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value as SettingOverride,
                  })
                }
                className="shrink-0 rounded-lg border border-aether-border bg-aether-bg px-2 py-1.5 text-sm outline-none"
              >
                <option value="inherit">Default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-aether-border pt-4">
        <ToolScopeFields
          value={value.notesScope}
          onChange={(notesScope) => onChange({ ...value, notesScope })}
          allowInherit
          inheritLabel="App default when persona is active"
          title="Linked Notes access"
          description="When this persona responds and the chat has not overridden scope, control root vs chat-only notes. Story mode uses its own app default unless the chat overrides."
        />
      </div>
    </div>
  );
}
