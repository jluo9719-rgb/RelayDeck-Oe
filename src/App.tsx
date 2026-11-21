/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { TopBar, type NavTab } from './components/TopBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ConsoleView } from './components/ConsoleView';
import { ApprovalsView } from './components/ApprovalsView';
import { WorkspacesView } from './components/WorkspacesView';
import { TunnelSetupView } from './components/TunnelSetupView';
import { NewSessionModal } from './components/NewSessionModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import type {
  AgentKind,
  BridgeState,
  HostCapabilities,
  PermissionPolicy,
  TunnelConfig,
} from './types/bridge';
import { bridgeApi, getStoredBridgeToken } from './utils/apiClient';
import {
  isDarkTheme,
  loadThemePreferences,
  saveThemePreferences,
  type ThemeId,
} from './utils/themeConfig';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('console');
  const [state, setState] = useState<BridgeState | null>(null);
  const [hostCaps, setHostCaps] = useState<HostCapabilities | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    try {
      return loadThemePreferences(localStorage).themeId;
    } catch {
      return 'anime';
    }
  });
  const [starfieldEnabled, setStarfieldEnabled] = useState<boolean>(() => {
    try {
      return loadThemePreferences(localStorage).starfieldEnabled;
    } catch {
      return true;
    }
  });

  const darkMode = isDarkTheme(themeId);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.dataset.theme = themeId;
    saveThemePreferences({ themeId, starfieldEnabled }, typeof localStorage !== 'undefined' ? localStorage : null);
  }, [darkMode, themeId, starfieldEnabled]);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextState, caps] = await Promise.all([bridgeApi.getState(), bridgeApi.getHealth()]);
      setState(nextState);
      setHostCaps(caps);
      setActiveSessionId((prev) =>
        prev && nextState.sessions.some((s) => s.id === prev)
          ? prev
          : nextState.sessions[0]?.id ?? null
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '无法连接到本地 Bridge 服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const token = getStoredBridgeToken();
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    const source = new EventSource(url);

    source.addEventListener('state_sync', (ev) => {
      try {
        const nextState = JSON.parse((ev as MessageEvent).data) as BridgeState;
        setState(nextState);
      } catch {
        // Ignore malformed payloads
      }
    });

    return () => {
      source.close();
    };
  }, []);

  const pendingCount = state
    ? state.approvals.filter((a) => a.status === 'pending').length
    : 0;

  const handleCreateSession = async (payload: {
    workspaceId: string;
    agent: AgentKind;
    title: string;
    initialPrompt: string;
  }) => {
    const res = await bridgeApi.createSession(payload);
    setState(res.state);
    setActiveSessionId(res.session.id);
    setActiveTab('console');
  };

  const handleDeleteSession = async (id: string) => {
    const res = await bridgeApi.deleteSession(id);
    setState(res.state);
    if (activeSessionId === id) {
      setActiveSessionId(res.state.sessions[0]?.id ?? null);
    }
  };

  const handleSendMessage = async (sessionId: string, prompt: string) => {
    const res = await bridgeApi.sendMessage(sessionId, prompt);
    setState(res.state);
  };

  const handleStopSession = async (sessionId: string) => {
    const res = await bridgeApi.stopSession(sessionId);
    setState(res.state);
  };

  const handleResolveApproval = async (
    id: string,
    decision: 'approved' | 'rejected',
    note?: string
  ) => {
    const res = await bridgeApi.resolveApproval(id, decision, note);
    setState(res.state);
  };

  const handleCreateWorkspace = async (payload: {
    name: string;
    path: string;
    branch: string;
    defaultAgent: AgentKind;
    policy: PermissionPolicy;
  }) => {
    const res = await bridgeApi.createWorkspace(payload);
    setState(res.state);
  };

  const handleUpdateWorkspace = async (
    id: string,
    patch: Partial<{ defaultAgent: AgentKind; policy: PermissionPolicy }>
  ) => {
    const res = await bridgeApi.updateWorkspace(id, patch);
    setState(res.state);
  };

  const handleDeleteWorkspace = async (id: string) => {
    const res = await bridgeApi.deleteWorkspace(id);
    setState(res.state);
    setActiveSessionId((prev) =>
      prev && res.state.sessions.some((s) => s.id === prev)
        ? prev
        : res.state.sessions[0]?.id ?? null
    );
  };

  const handleLaunchFromWorkspace = async (workspaceId: string, agent: AgentKind) => {
    const res = await bridgeApi.createSession({ workspaceId, agent });
    setState(res.state);
    setActiveSessionId(res.session.id);
    setActiveTab('console');
  };

  const handleSaveTunnelConfig = async (patch: Partial<TunnelConfig>) => {
    const res = await bridgeApi.updateTunnelConfig(patch);
    setState(res.state);
  };

  const handleJumpToSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveTab('console');
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingCount={pendingCount}
        onNewSession={() => setNewSessionOpen(true)}
      />

      <main>
        {loading && !state ? (
          <div className="mx-auto max-w-4xl px-6 py-16">
            <div className="space-y-4">
              <div className="h-7 w-48 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
              <div className="h-32 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-900" />
              <div className="h-32 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-900" />
            </div>
          </div>
        ) : loadError && !state ? (
          <div className="mx-auto max-w-md px-6 py-20 text-center">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              无法连接到 Bridge 服务
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{loadError}</p>
            <button
              type="button"
              onClick={() => void hydrate()}
              className="mt-5 min-h-[44px] rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
            >
              重新连接
            </button>
          </div>
        ) : state ? (
          <>
            {activeTab === 'console' && (
              <ConsoleView
                workspaces={state.workspaces}
                sessions={state.sessions}
                approvals={state.approvals}
                activeSessionId={activeSessionId}
                hostCaps={hostCaps}
                themeId={themeId}
                starfieldEnabled={starfieldEnabled}
                onSelectTheme={setThemeId}
                onToggleStarfield={() => setStarfieldEnabled((prev) => !prev)}
                onSelectSession={setActiveSessionId}
                onNewSession={() => setNewSessionOpen(true)}
                onDeleteSession={handleDeleteSession}
                onSendMessage={handleSendMessage}
                onStopSession={handleStopSession}
                onResolveApproval={handleResolveApproval}
                onOpenTunnelSetup={() => setActiveTab('tunnel')}
              />
            )}

            {activeTab === 'approvals' && (
              <ApprovalsView
                approvals={state.approvals}
                onResolve={handleResolveApproval}
                onJumpToSession={handleJumpToSession}
              />
            )}

            {activeTab === 'workspaces' && (
              <WorkspacesView
                workspaces={state.workspaces}
                onCreate={handleCreateWorkspace}
                onUpdate={handleUpdateWorkspace}
                onDelete={handleDeleteWorkspace}
                onLaunchSession={handleLaunchFromWorkspace}
              />
            )}

            {activeTab === 'tunnel' && (
              <TunnelSetupView
                config={state.tunnelConfig}
                hostCaps={hostCaps}
                darkMode={darkMode}
                onToggleDarkMode={() => setThemeId((prev) => (isDarkTheme(prev) ? 'light' : 'anime'))}
                onSaveConfig={handleSaveTunnelConfig}
              />
            )}
          </>
        ) : null}
      </main>

      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingCount={pendingCount}
      />

      {state && (
        <NewSessionModal
          open={newSessionOpen}
          workspaces={state.workspaces}
          defaultWorkspaceId={
            state.sessions.find((s) => s.id === activeSessionId)?.workspaceId ??
            state.workspaces[0]?.id
          }
          onClose={() => setNewSessionOpen(false)}
          onCreate={handleCreateSession}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
