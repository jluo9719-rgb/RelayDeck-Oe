import React from 'react';
import { FolderGit2, ShieldCheck, TerminalSquare, Waypoints } from 'lucide-react';
import type { NavTab } from './TopBar';

interface MobileBottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  pendingCount,
}) => {
  const tabs: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'console', label: '控制台', icon: TerminalSquare },
    { id: 'approvals', label: pendingCount > 0 ? `审批(${pendingCount})` : '审批', icon: ShieldCheck },
    { id: 'workspaces', label: '工作区', icon: FolderGit2 },
    { id: 'tunnel', label: '隧道', icon: Waypoints },
  ];

  return (
    <nav
      aria-label="移动端底部导航"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="grid h-[60px] grid-cols-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(tab.id)}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors tabular-nums ${
                active
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${active ? 'text-blue-600 dark:text-blue-400' : ''}`}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
