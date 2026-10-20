import { useEffect } from 'react';
import { useAppStore } from '../store/app-store';

const DESKTOP_BREAKPOINT = '(min-width: 768px)';

export function useSidebarLayout(): void {
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_BREAKPOINT);

    const sync = (event?: MediaQueryListEvent) => {
      const isDesktop = event ? event.matches : mq.matches;
      setSidebarOpen(isDesktop);
    };

    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [setSidebarOpen]);
}