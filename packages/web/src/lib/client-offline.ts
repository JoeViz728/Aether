import { isSimulateOffline } from './offline-debug';
import { useConnectionStore, type ConnectionQuality } from '../store/connection-store';

export const DRAFT_CONVERSATION_REF = '__draft__';

export function isClientOffline(quality?: ConnectionQuality): boolean {
  if (isSimulateOffline()) return true;
  const connectionQuality = quality ?? useConnectionStore.getState().quality;
  return connectionQuality === 'offline';
}

export function canReachServer(quality?: ConnectionQuality): boolean {
  return !isClientOffline(quality);
}