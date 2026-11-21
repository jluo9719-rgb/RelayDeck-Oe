import type {
  AgentKind,
  BridgeState,
  HostCapabilities,
  PermissionPolicy,
  TunnelConfig,
} from '../types/bridge';

const TOKEN_STORAGE_KEY = 'relaydeck_bridge_token';

export function getStoredBridgeToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredBridgeToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota issues
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredBridgeToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export const bridgeApi = {
  getHealth: () => requestJson<HostCapabilities>('/api/health'),
  getState: () => requestJson<BridgeState>('/api/state'),

  createWorkspace: (payload: {
    name: string;
    path: string;
    branch?: string;
    defaultAgent: AgentKind;
    policy: PermissionPolicy;
  }) =>
    requestJson<{ state: BridgeState }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateWorkspace: (
    id: string,
    payload: Partial<{ defaultAgent: AgentKind; policy: PermissionPolicy; branch: string }>
  ) =>
    requestJson<{ state: BridgeState }>(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteWorkspace: (id: string) =>
    requestJson<{ state: BridgeState }>(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  createSession: (payload: {
    workspaceId: string;
    agent: AgentKind;
    title?: string;
    initialPrompt?: string;
  }) =>
    requestJson<{ session: { id: string }; state: BridgeState }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteSession: (id: string) =>
    requestJson<{ state: BridgeState }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  sendMessage: (sessionId: string, prompt: string) =>
    requestJson<{ state: BridgeState }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  stopSession: (sessionId: string) =>
    requestJson<{ state: BridgeState }>(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    }),

  resolveApproval: (approvalId: string, decision: 'approved' | 'rejected', note?: string) =>
    requestJson<{ state: BridgeState }>(
      `/api/approvals/${encodeURIComponent(approvalId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      }
    ),

  updateTunnelConfig: (patch: Partial<TunnelConfig>) =>
    requestJson<{ tunnelConfig: TunnelConfig; state: BridgeState }>('/api/tunnel-config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};
