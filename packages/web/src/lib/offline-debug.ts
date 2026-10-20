const STORAGE_KEY = 'aether:debug:simulate-offline';

export class OfflineError extends Error {
  constructor(message = 'Offline') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function isSimulateOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

export function setSimulateOffline(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

export function assertOnline(): void {
  if (isSimulateOffline()) {
    throw new OfflineError('Simulated offline mode');
  }
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError || (err instanceof TypeError && err.message === 'Failed to fetch');
}