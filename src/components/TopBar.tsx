import React from 'react';
import { Plus } from 'lucide-react';

export type NavTab = 'console' | 'approvals' | 'workspaces' | 'tunnel';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingCount: number;
  onNewSession: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  pendingCount,
  onNewSession,
}) => {
  const navItems: Array<{ id: NavTab; label: string }> = [
    { id: 'console', label: '控制台' },
    { id: 'approvals', label: pendingCount > 0 ? `审批队列 (${pendingCount})` : '审批队列' },
    { id: 'workspaces', label: '工作区' },
    { id: 'tunnel', label: '隧道部署' },
  ];

  return (
    <header className="sticky top-0 z-30 h-[52px] border-b border-slate-200 bg-white/95 backdrop-blur-md md:h-16 dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-8 px-4 md:px-6">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('console')}
          className="text-lg font-bold tracking-tight text-slate-900 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          RelayDeck
        </button>

        {/* Zone 2: Clean single-line text navigation links (desktop) */}
        <nav aria-label="主导航" className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
                className={`relative flex h-16 items-center text-sm font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900 dark:bg-slate-100"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onNewSession}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>新建会话</span>
          </button>
        </div>
      </div>
    </header>
  );
};
