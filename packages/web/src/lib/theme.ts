export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const PREF_KEY = 'aether-theme-pref';
const RESOLVED_KEY = 'aether-resolved-theme';

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return getSystemTheme();
  return preference;
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);

  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#0a0a0a' : '#fafafa');
  }

  localStorage.setItem(PREF_KEY, preference);
  localStorage.setItem(RESOLVED_KEY, resolved);

  return resolved;
}

export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  const handler = () => onChange(getSystemTheme());
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export function bootstrapTheme(): void {
  const pref = (localStorage.getItem(PREF_KEY) as ThemePreference | null) ?? 'system';
  applyTheme(pref);
}