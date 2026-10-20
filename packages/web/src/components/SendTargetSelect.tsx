import { AETHER_MODELS } from '@aether/shared';
import type { Persona } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { AUTO_SELECT_LABEL, SEND_TARGET_AUTO } from '../lib/send-target';

interface Props {
  value: string;
  onChange: (value: string) => void;
  personas?: Persona[];
  showPersonas?: boolean;
  showAuto?: boolean;
  id?: string;
  className?: string;
}

export function SendTargetSelect({
  value,
  onChange,
  personas = [],
  showPersonas = true,
  showAuto = true,
  id,
  className,
}: Props) {
  const availableModels = useAppStore((s) => s.availableModels);
  const modelOptions = (availableModels.length > 0
    ? availableModels
    : AETHER_MODELS.map((m) => m.id)
  ).map((id: string) => ({ id, label: id }));

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full rounded-lg border border-aether-border bg-aether-bg px-3 py-2 text-sm outline-none'}
    >
      {showAuto && (
        <option value={SEND_TARGET_AUTO}>{AUTO_SELECT_LABEL}</option>
      )}
      <optgroup label="Models">
        {modelOptions.map((model: { id: string; label: string }) => (
          <option key={model.id} value={`model:${model.id}`}>{model.label}</option>
        ))}
      </optgroup>
      {showPersonas && personas.length > 0 && (
        <optgroup label="Personas">
          {personas.map((persona) => (
            <option key={persona.id} value={`persona:${persona.id}`}>{persona.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}