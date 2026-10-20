import { create } from 'zustand';
import { isSimulateOffline } from '../lib/offline-debug';

export type ConnectionQuality = 'online' | 'degraded' | 'offline';

const PING_INTERVAL_MS = 5000;
const RTT_WINDOW = 10;
const DEGRADED_RTT_MS = 800;
const OFFLINE_AFTER_FAILURES = 3;

interface ConnectionStore {
  quality: ConnectionQuality;
  lastRttMs: number | null;
  averageRttMs: number | null;
  consecutiveFailures: number;
  lastPingAt: string | null;
  rttSamples: number[];
  ping: () => Promise<void>;
  startMonitoring: () => () => void;
}

function deriveQuality(
  consecutiveFailures: number,
  averageRttMs: number | null,
): ConnectionQuality {
  if (consecutiveFailures >= OFFLINE_AFTER_FAILURES) return 'offline';
  if (averageRttMs !== null && averageRttMs >= DEGRADED_RTT_MS) return 'degraded';
  if (consecutiveFailures > 0) return 'degraded';
  return 'online';
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  quality: 'online',
  lastRttMs: null,
  averageRttMs: null,
  consecutiveFailures: 0,
  lastPingAt: null,
  rttSamples: [],

  ping: async () => {
    if (isSimulateOffline()) {
      set({
        quality: 'offline',
        consecutiveFailures: OFFLINE_AFTER_FAILURES,
        lastPingAt: new Date().toISOString(),
      });
      return;
    }

    const started = performance.now();
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Ping failed (${res.status})`);

      const rtt = Math.round(performance.now() - started);
      const samples = [...get().rttSamples, rtt].slice(-RTT_WINDOW);
      const averageRttMs = Math.round(samples.reduce((sum, n) => sum + n, 0) / samples.length);

      set({
        lastRttMs: rtt,
        averageRttMs,
        rttSamples: samples,
        consecutiveFailures: 0,
        lastPingAt: new Date().toISOString(),
        quality: deriveQuality(0, averageRttMs),
      });
    } catch {
      const consecutiveFailures = get().consecutiveFailures + 1;
      set({
        consecutiveFailures,
        lastPingAt: new Date().toISOString(),
        quality: deriveQuality(consecutiveFailures, get().averageRttMs),
      });
    }
  },

  startMonitoring: () => {
    const { ping } = get();
    void ping();
    const interval = window.setInterval(() => void ping(), PING_INTERVAL_MS);
    return () => window.clearInterval(interval);
  },
}));

export function isConnectionUsable(quality: ConnectionQuality): boolean {
  return quality !== 'offline';
}