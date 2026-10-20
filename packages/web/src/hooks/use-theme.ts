import { useEffect } from 'react';
import type { ThemePreference } from '../lib/theme';
import { applyTheme, watchSystemTheme } from '../lib/theme';

export function useTheme(preference: ThemePreference | undefined): void {
  useEffect(() => {
    if (!preference) return;

    applyTheme(preference);

    if (preference !== 'system') return;

    return watchSystemTheme(() => applyTheme('system'));
  }, [preference]);
}