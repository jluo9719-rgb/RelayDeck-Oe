export type AgentKind = 'claude' | 'codex';

export type PermissionPolicy = 'confirm-writes' | 'read-only-auto' | 'high-risk-only';

export type SessionStatus = 'idle' | 'running' | 'awaiting_approval' | 'error';

export type RiskLevel = 'low' | 'moderate' | 'high';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  branch: string;
  defaultAgent: AgentKind;
  policy: PermissionPolicy;
  lastActiveAt: string;
}

export interface FileDiff {
  id: string;
  filePath: string;
  additions: number;
  deletions: number;
  hunks: string[];
}

export interface TimelineEvent {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  kind: 'message' | 'command' | 'diff' | 'approval' | 'notice';
  content: string;
  command?: string;
  exitCode?: number;
  approvalId?: string;
  diff?: FileDiff;
  createdAt: string;
  streaming?: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  agent: AgentKind;
  actionType: 'shell' | 'file_write';
  summary: string;
  command: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  note?: string;
}

export interface AgentSession {
  id: string;
  workspaceId: string;
  agent: AgentKind;
  title: string;
  status: SessionStatus;
  cliSessionId?: string;
  modelLabel: string;
  updatedAt: string;
  events: TimelineEvent[];
  diffs: FileDiff[];
}

export interface TunnelConfig {
  rootDomain: string;
  subdomain: string;
  tunnelName: string;
  localPort: number;
  allowedEmail: string;
  authToken: string;
  keepAwake: boolean;
  windowsBridgeDir: string;
}

export interface HostCapabilities {
  platform: string;
  hostname: string;
  execMode: 'live' | 'preview';
  binaries: {
    claude: boolean;
    codex: boolean;
    cloudflared: boolean;
    git: boolean;
  };
  authEnforced: boolean;
  cfAccessEmail?: string;
}

export interface BridgeState {
  workspaces: Workspace[];
  sessions: AgentSession[];
  approvals: ApprovalRequest[];
  tunnelConfig: TunnelConfig;
}

export interface ParsedStreamOutput {
  kind: 'text' | 'tool_use' | 'tool_result' | 'session_id' | 'error' | 'ignore';
  text?: string;
  command?: string;
  sessionId?: string;
  isFinal?: boolean;
}

export interface DomainCompatibility {
  domain: string;
  compatible: boolean;
  providerHint: string;
  reason: string;
  recommendation: string;
}
