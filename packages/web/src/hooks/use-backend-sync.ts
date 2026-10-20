import { useEffect } from 'react';
import { canReachServer } from '../lib/client-offline';
import { useAppStore } from '../store/app-store';
import { useConnectionStore } from '../store/connection-store';
import { useIntentQueueStore } from '../store/intent-queue-store';
import { useTaskStore } from '../store/task-store';

const TASK_SYNC_INTERVAL_MS = 3000;

export function useBackendSync() {
  const initialized = useAppStore((state) => state.initialized);
  const reconcileAfterTaskSync = useAppStore((state) => state.reconcileAfterTaskSync);
  const flushIntentQueue = useAppStore((state) => state.flushIntentQueue);

  useEffect(() => {
    if (!initialized) return;

    useIntentQueueStore.getState().hydrateTaskLog();

    const stopConnectionMonitoring = useConnectionStore.getState().startMonitoring();

    const runTaskSync = async () => {
      if (canReachServer()) {
        await flushIntentQueue();
      }

      const previousTasks = useTaskStore.getState().tasks;
      await useTaskStore.getState().syncFromServer();
      await reconcileAfterTaskSync(previousTasks);
    };

    void runTaskSync();
    const taskInterval = window.setInterval(() => void runTaskSync(), TASK_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(taskInterval);
      stopConnectionMonitoring();
    };
  }, [initialized, reconcileAfterTaskSync, flushIntentQueue]);
}