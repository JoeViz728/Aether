import { useEffect, useState } from 'react';
import { useAppStore } from './store/app-store';
import { useTheme } from './hooks/use-theme';
import { useSidebarLayout } from './hooks/use-sidebar-layout';
import { VoiceProvider } from './context/voice-context';
import { isSimulateOffline } from './lib/offline-debug';
import { useBackendSync } from './hooks/use-backend-sync';
import { useConnectionStore } from './store/connection-store';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { SettingsModal } from './components/SettingsModal';
import { ApprovalModal } from './components/ApprovalModal';
import { PersonasModal } from './components/PersonasModal';
import { TasksModal } from './components/TasksModal';
import { ToolsModal } from './components/ToolsModal';
import { SearchConversationsModal } from './components/SearchConversationsModal';

export default function App() {
  const { initialized, initialize, settings, error } = useAppStore();
  const [offlineSimulated, setOfflineSimulated] = useState(isSimulateOffline());

  const connectionQuality = useConnectionStore((state) => state.quality);

  useTheme(settings?.theme ?? 'system');
  useSidebarLayout();
  useBackendSync();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    setOfflineSimulated(isSimulateOffline());
  }, [initialized, error]);

  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-aether-muted">
          <div className="h-2 w-2 rounded-full bg-aether-muted animate-pulse-dot" />
          <div className="h-2 w-2 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.2s]" />
          <div className="h-2 w-2 rounded-full bg-aether-muted animate-pulse-dot [animation-delay:0.4s]" />
        </div>
      </div>
    );
  }

  return (
    <VoiceProvider>
      <div className="flex h-full flex-col overflow-hidden">
        {offlineSimulated && (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
            Simulated offline mode — network requests are blocked; cached data is shown where available.
          </div>
        )}
        {!offlineSimulated && connectionQuality !== 'online' && (
          <div
            className={
              connectionQuality === 'offline'
                ? 'shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-200'
                : 'shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200'
            }
          >
            {connectionQuality === 'offline'
              ? 'Offline — waiting to reconnect to Aether. Tasks will sync when the connection returns.'
              : 'Unstable connection — responses may be delayed. Syncing with the server.'}
          </div>
        )}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <ChatArea />
          <SettingsModal />
          <ApprovalModal />
          <PersonasModal />
          <TasksModal />
          <ToolsModal />
          <SearchConversationsModal />
        </div>
      </div>
    </VoiceProvider>
  );
}