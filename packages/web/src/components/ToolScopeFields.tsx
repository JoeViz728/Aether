import clsx from 'clsx';
import type { ToolResourceAccess, ToolScopeConfig } from '@aether/shared';
import { NOTES_ACCESS_LABELS } from '@aether/shared';

export type ScopeAccessChoice = 'inherit' | ToolResourceAccess;

export interface ToolScopeFormState {
  /** inherit = no override (conversation/persona) */
  access: ScopeAccessChoice;
  allowMoveToRoot: boolean;
  allowMoveFromRoot: boolean;
}

export function toolScopeFormFromConfig(
  config?: ToolScopeConfig | null,
  mode: 'override' | 'required' = 'override',
): ToolScopeFormState {
  if (!config) {
    return {
      access: mode === 'required' ? 'all' : 'inherit',
      allowMoveToRoot: true,
      allowMoveFromRoot: false,
    };
  }
  return {
    access: config.access,
    allowMoveToRoot: config.allowMoveToRoot ?? config.allowPromoteToRoot ?? true,
    allowMoveFromRoot: config.allowMoveFromRoot ?? false,
  };
}

export function toolScopeFormToConfig(form: ToolScopeFormState): ToolScopeConfig | null {
  if (form.access === 'inherit') return null;
  return {
    access: form.access,
    allowMoveToRoot: form.allowMoveToRoot,
    allowMoveFromRoot: form.allowMoveFromRoot,
    allowPromoteToRoot: form.allowMoveToRoot,
  };
}

interface Props {
  value: ToolScopeFormState;
  onChange: (value: ToolScopeFormState) => void;
  /** Show inherit option (conversation / persona). App defaults omit it. */
  allowInherit?: boolean;
  inheritLabel?: string;
  title?: string;
  description?: string;
  compact?: boolean;
}

export function ToolScopeFields({
  value,
  onChange,
  allowInherit = false,
  inheritLabel = 'Inherit default',
  title = 'Linked Notes access (model)',
  description,
  compact,
}: Props) {
  return (
    <div className={clsx(!compact && 'rounded-lg border border-aether-border p-3 space-y-3')}>
      {title && <p className={clsx('font-medium', compact ? 'text-xs' : 'text-sm')}>{title}</p>}
      {description && (
        <p className="text-xs text-aether-muted leading-relaxed">{description}</p>
      )}

      <label className="block text-xs text-aether-muted mb-1">What the model may use</label>
      <select
        value={value.access}
        onChange={(e) =>
          onChange({ ...value, access: e.target.value as ScopeAccessChoice })
        }
        className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none"
      >
        {allowInherit && <option value="inherit">{inheritLabel}</option>}
        <option value="all">{NOTES_ACCESS_LABELS.all}</option>
        <option value="conversation">{NOTES_ACCESS_LABELS.conversation}</option>
        <option value="none">{NOTES_ACCESS_LABELS.none}</option>
      </select>

      {value.access !== 'inherit' && value.access !== 'none' && (
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={value.allowMoveToRoot}
              onChange={(e) => onChange({ ...value, allowMoveToRoot: e.target.checked })}
              className="rounded"
            />
            Model may move chat notes → root library
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={value.allowMoveFromRoot}
              onChange={(e) => onChange({ ...value, allowMoveFromRoot: e.target.checked })}
              className="rounded"
            />
            Model may move root notes → this chat
          </label>
          <p className="text-[10px] text-aether-muted leading-relaxed">
            You can always move notes either way in the Linked Notes UI.
          </p>
        </div>
      )}
    </div>
  );
}

/** Compact access-only select for app default rows */
export function NotesAccessSelect({
  value,
  onChange,
  id,
}: {
  value: ToolResourceAccess;
  onChange: (v: ToolResourceAccess) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ToolResourceAccess)}
      className="w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none"
    >
      <option value="all">{NOTES_ACCESS_LABELS.all}</option>
      <option value="conversation">{NOTES_ACCESS_LABELS.conversation}</option>
      <option value="none">{NOTES_ACCESS_LABELS.none}</option>
    </select>
  );
}
