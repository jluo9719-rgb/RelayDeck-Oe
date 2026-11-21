import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 shadow-lg md:bottom-6 md:left-6 md:right-auto dark:border-amber-700/60 dark:bg-amber-950 dark:text-amber-100"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>当前网络已离线，正展示本地缓存数据，恢复连接后将自动同步。</span>
    </div>
  );
};
