import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { AETHER_MODELS } from '@aether/shared';
import type { Persona } from '@aether/shared';
import { useAppStore } from '../store/app-store';
import { choiceLabel } from '../lib/chat-responder';
import { AUTO_SELECT_LABEL, parseSendTargetValue, SEND_TARGET_AUTO } from '../lib/send-target';

interface Props {
  value: string;
  onChange: (value: string) => void;
  personas?: Persona[];
  showPersonas?: boolean;
  disabled?: boolean;
  stacked?: boolean;
  className?: string;
}

export function SendToInline({
  value,
  onChange,
  personas = [],
  showPersonas = true,
  disabled,
  stacked = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const availableModels = useAppStore((s) => s.availableModels);
  const modelsForLabel = availableModels.length > 0
    ? availableModels.map((id: string) => ({ id, label: id }))
    : AETHER_MODELS;
  const targetLabel = choiceLabel(parseSendTargetValue(value), personas, modelsForLabel);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative flex shrink-0 items-center',
        stacked
          ? 'w-full border-b border-aether-border pb-1.5'
          : 'border-r border-aether-border pr-2.5 mr-2 self-stretch',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={`Send to ${targetLabel}`}
        aria-expanded={open}
        className="inline-flex items-center gap-0.5 rounded-md px-0.5 py-0.5 text-xs transition-colors hover:bg-aether-surface-2"
      >
        <span className="text-aether-muted">To</span>
        <span className="font-medium text-aether-text whitespace-nowrap">{targetLabel}</span>
        <ChevronDown
          className={clsx(
            'h-3 w-3 shrink-0 text-aether-muted transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-max min-w-[10rem] overflow-y-auto rounded-lg border border-aether-border bg-aether-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => pick(SEND_TARGET_AUTO)}
            className={clsx(
              'flex w-full px-3 py-2 text-left text-sm hover:bg-aether-surface-2 transition-colors',
              value === SEND_TARGET_AUTO && 'bg-aether-surface-2 font-medium',
            )}
          >
            {AUTO_SELECT_LABEL}
          </button>

          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-aether-muted">
            Models
          </p>
          {modelsForLabel.map((model: { id: string; label: string }) => {
            const optionValue = `model:${model.id}`;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => pick(optionValue)}
                className={clsx(
                  'flex w-full px-3 py-2 text-left text-sm hover:bg-aether-surface-2 transition-colors',
                  value === optionValue && 'bg-aether-surface-2 font-medium',
                )}
              >
                {model.label}
              </button>
            );
          })}

          {showPersonas && personas.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-aether-muted">
                Personas
              </p>
              {personas.map((persona) => {
                const optionValue = `persona:${persona.id}`;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    onClick={() => pick(optionValue)}
                    className={clsx(
                      'flex w-full px-3 py-2 text-left text-sm hover:bg-aether-surface-2 transition-colors',
                      value === optionValue && 'bg-aether-surface-2 font-medium',
                    )}
                  >
                    {persona.name}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}