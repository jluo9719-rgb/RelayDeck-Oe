import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentKind,
  AgentSession,
  ApprovalRequest,
  BridgeState,
  FileDiff,
  PermissionPolicy,
  TimelineEvent,
  TunnelConfig,
  Workspace,
} from '../types/bridge.ts';
import { generateSecureToken } from '../utils/bridgeLogic.ts';

function nowMinusMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createInitialState(): BridgeState {
  const wsApiId = 'ws-gateway-api';
  const wsWebId = 'ws-storefront-web';
  const sessClaudeId = 'sess-claude-auth';
  const sessCodexId = 'sess-codex-tests';
  const pendingApprovalId = 'apr-run-migration-check';

  const workspaces: Workspace[] = [
    {
      id: wsApiId,
      name: 'gateway-api',
      path: 'D:\\Projects\\gateway-api',
      branch: 'fix/token-refresh',
      defaultAgent: 'claude',
      policy: 'confirm-writes',
      lastActiveAt: nowMinusMinutes(4),
    },
    {
      id: wsWebId,
      name: 'storefront-web',
      path: 'D:\\Projects\\storefront-web',
      branch: 'feat/mobile-checkout',
      defaultAgent: 'codex',
      policy: 'read-only-auto',
      lastActiveAt: nowMinusMinutes(18),
    },
  ];

  const initialDiff: FileDiff = {
    id: 'diff-auth-retry',
    filePath: 'src/middleware/sessionGuard.ts',
    additions: 11,
    deletions: 3,
    hunks: [
      '@@ -42,9 +42,17 @@ export async function verifyAccessHeader(req: Request) {',
      '   const email = req.header("Cf-Access-Authenticated-User-Email");',
      '-  if (!email) {',
      '-    return { ok: false, reason: "missing_header" };',
      '-  }',
      '+  if (!email) {',
      '+    return { ok: false, reason: "missing_cf_access_email" };',
      '+  }',
      '+  const normalized = email.trim().toLowerCase();',
      '+  if (ALLOWED_EMAILS.size > 0 && !ALLOWED_EMAILS.has(normalized)) {',
      '+    return { ok: false, reason: "email_not_allowlisted" };',
      '+  }',
      '+  return { ok: true, email: normalized, checkedAt: Date.now() };',
      ' }',
    ],
  };

  const codexDiff: FileDiff = {
    id: 'diff-checkout-test',
    filePath: 'tests/cartTotals.test.ts',
    additions: 14,
    deletions: 0,
    hunks: [
      '@@ -18,0 +19,14 @@ describe("calculateCartTotals", () => {',
      '+  it("clamps discount so payable amount never drops below zero", () => {',
      '+    const result = calculateCartTotals({',
      '+      items: [{ sku: "KB-01", unitPrice: 120, qty: 1 }],',
      '+      couponAmount: 200,',
      '+    });',
      '+    expect(result.subtotal).toBe(120);',
      '+    expect(result.payable).toBe(0);',
      '+  });',
      '+});',
    ],
  };

  const sessions: AgentSession[] = [
    {
      id: sessClaudeId,
      workspaceId: wsApiId,
      agent: 'claude',
      title: '排查 Cloudflare Access 鉴权头校验与重试逻辑',
      status: 'awaiting_approval',
      cliSessionId: 'cl_01j9x7m4q2w8',
      modelLabel: 'Claude Code CLI',
      updatedAt: nowMinusMinutes(2),
      diffs: [initialDiff],
      events: [
        {
          id: 'ev-1',
          role: 'user',
          kind: 'message',
          content: '检查 gateway-api 里的 Cloudflare Access 邮箱白名单校验，补上大小写归一化并跑一遍鉴权测试。',
          createdAt: nowMinusMinutes(6),
        },
        {
          id: 'ev-2',
          role: 'assistant',
          kind: 'message',
          content:
            '已定位到 `src/middleware/sessionGuard.ts`。当前逻辑只检查了请求头是否存在，尚未对 `Cf-Access-Authenticated-User-Email` 做去空格与小写归一化，也未比对白名单集合。我已生成补丁并准备执行单元测试验证。',
          createdAt: nowMinusMinutes(5),
        },
        {
          id: 'ev-3',
          role: 'tool',
          kind: 'diff',
          content: '已修改 src/middleware/sessionGuard.ts（+11 / -3）',
          diff: initialDiff,
          createdAt: nowMinusMinutes(4),
        },
        {
          id: 'ev-4',
          role: 'system',
          kind: 'approval',
          content: '等待手机端审批：运行鉴权模块测试并重新构建本地包',
          command: 'npm run test -- sessionGuard && npm run build',
          approvalId: pendingApprovalId,
          createdAt: nowMinusMinutes(2),
        },
      ],
    },
    {
      id: sessCodexId,
      workspaceId: wsWebId,
      agent: 'codex',
      title: '补全购物车优惠券边界单元测试',
      status: 'idle',
      cliSessionId: 'cdx_thread_8841a',
      modelLabel: 'OpenAI Codex CLI',
      updatedAt: nowMinusMinutes(18),
      diffs: [codexDiff],
      events: [
        {
          id: 'ev-c1',
          role: 'user',
          kind: 'message',
          content: '给 storefront-web 的购物车结算函数补一条满减大于商品总额时的边界测试。',
          createdAt: nowMinusMinutes(22),
        },
        {
          id: 'ev-c2',
          role: 'tool',
          kind: 'command',
          content: 'tests/cartTotals.test.ts: 6 passed, 0 failed (412ms)',
          command: 'npx vitest run tests/cartTotals.test.ts',
          exitCode: 0,
          createdAt: nowMinusMinutes(19),
        },
        {
          id: 'ev-c3',
          role: 'assistant',
          kind: 'message',
          content:
            '已在 `tests/cartTotals.test.ts` 新增边界测试用例，确认当优惠券面额大于小计时应付金额安全归零。全部 6 项测试通过。',
          createdAt: nowMinusMinutes(18),
        },
      ],
    },
  ];

  const approvals: ApprovalRequest[] = [
    {
      id: pendingApprovalId,
      sessionId: sessClaudeId,
      workspaceId: wsApiId,
      workspaceName: 'gateway-api',
      agent: 'claude',
      actionType: 'shell',
      summary: '运行鉴权中间件单元测试并重新编译构建产物',
      command: 'npm run test -- sessionGuard && npm run build',
      risk: 'moderate',
      status: 'pending',
      createdAt: nowMinusMinutes(2),
    },
    {
      id: 'apr-codex-vitest',
      sessionId: sessCodexId,
      workspaceId: wsWebId,
      workspaceName: 'storefront-web',
      agent: 'codex',
      actionType: 'shell',
      summary: '执行购物车边界单元测试套件',
      command: 'npx vitest run tests/cartTotals.test.ts',
      risk: 'low',
      status: 'approved',
      createdAt: nowMinusMinutes(20),
      resolvedAt: nowMinusMinutes(19),
      note: '只读测试命令，已放行',
    },
  ];

  const tunnelConfig: TunnelConfig = {
    rootDomain: 'example.com',
    subdomain: 'agent',
    tunnelName: 'windows-agent-bridge',
    localPort: 3000,
    allowedEmail: 'you@example.com',
    authToken: process.env.BRIDGE_AUTH_TOKEN || generateSecureToken(28),
    keepAwake: true,
    windowsBridgeDir: 'D:\\Tools\\relaydeck',
  };

  return {
    workspaces,
    sessions,
    approvals,
    tunnelConfig,
  };
}

export class BridgeStore {
  private readonly filePath: string;
  private state: BridgeState;

  constructor(dataDir = process.env.BRIDGE_DATA_DIR || '.bridge-data') {
    const resolvedDir = path.resolve(process.cwd(), dataDir);
    fs.mkdirSync(resolvedDir, { recursive: true });
    this.filePath = path.join(resolvedDir, 'state.json');
    this.state = this.load();
  }

  private load(): BridgeState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as BridgeState;
        if (parsed && Array.isArray(parsed.workspaces) && Array.isArray(parsed.sessions)) {
          return parsed;
        }
      }
    } catch {
      // Fall back to fresh seed state when local file is corrupted
    }
    const seed = createInitialState();
    this.persist(seed);
    return seed;
  }

  private persist(nextState: BridgeState = this.state): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(nextState, null, 2), 'utf-8');
    } catch {
      // Ignore write failures in read-only environments
    }
  }

  getState(): BridgeState {
    return this.state;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.state.workspaces.find((w) => w.id === id);
  }

  addWorkspace(input: {
    name: string;
    path: string;
    branch?: string;
    defaultAgent: AgentKind;
    policy: PermissionPolicy;
  }): Workspace {
    const ws: Workspace = {
      id: `ws-${Date.now().toString(36)}`,
      name: input.name,
      path: input.path,
      branch: input.branch?.trim() || 'main',
      defaultAgent: input.defaultAgent,
      policy: input.policy,
      lastActiveAt: new Date().toISOString(),
    };
    this.state.workspaces = [ws, ...this.state.workspaces];
    this.persist();
    return ws;
  }

  updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'defaultAgent' | 'policy' | 'branch'>>): Workspace | null {
    const ws = this.getWorkspace(id);
    if (!ws) return null;
    Object.assign(ws, patch, { lastActiveAt: new Date().toISOString() });
    this.persist();
    return ws;
  }

  deleteWorkspace(id: string): boolean {
    const prev = this.state.workspaces.length;
    this.state.workspaces = this.state.workspaces.filter((w) => w.id !== id);
    if (this.state.workspaces.length === prev) return false;
    const removedSessionIds = new Set(this.state.sessions.filter((s) => s.workspaceId === id).map((s) => s.id));
    this.state.sessions = this.state.sessions.filter((s) => s.workspaceId !== id);
    this.state.approvals = this.state.approvals.filter((a) => !removedSessionIds.has(a.sessionId));
    this.persist();
    return true;
  }

  getSession(id: string): AgentSession | undefined {
    return this.state.sessions.find((s) => s.id === id);
  }

  createSession(input: { workspaceId: string; agent: AgentKind; title?: string }): AgentSession | null {
    const ws = this.getWorkspace(input.workspaceId);
    if (!ws) return null;
    const session: AgentSession = {
      id: `sess-${Date.now().toString(36)}`,
      workspaceId: ws.id,
      agent: input.agent,
      title: input.title?.trim() || `${input.agent === 'claude' ? 'Claude Code' : 'Codex CLI'} · ${ws.name}`,
      status: 'idle',
      modelLabel: input.agent === 'claude' ? 'Claude Code CLI' : 'OpenAI Codex CLI',
      updatedAt: new Date().toISOString(),
      events: [],
      diffs: [],
    };
    this.state.sessions = [session, ...this.state.sessions];
    ws.lastActiveAt = session.updatedAt;
    this.persist();
    return session;
  }

  deleteSession(id: string): boolean {
    const prev = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    if (this.state.sessions.length === prev) return false;
    this.state.approvals = this.state.approvals.filter((a) => a.sessionId !== id);
    this.persist();
    return true;
  }

  appendEvent(sessionId: string, event: TimelineEvent): AgentSession | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.events.push(event);
    session.updatedAt = new Date().toISOString();
    const ws = this.getWorkspace(session.workspaceId);
    if (ws) ws.lastActiveAt = session.updatedAt;
    this.persist();
    return session;
  }

  updateEvent(sessionId: string, eventId: string, patch: Partial<TimelineEvent>): TimelineEvent | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const ev = session.events.find((e) => e.id === eventId);
    if (!ev) return null;
    Object.assign(ev, patch);
    session.updatedAt = new Date().toISOString();
    this.persist();
    return ev;
  }

  removeEvent(sessionId: string, eventId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const prevLen = session.events.length;
    session.events = session.events.filter((e) => e.id !== eventId);
    if (session.events.length !== prevLen) {
      session.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  addDiff(sessionId: string, diff: FileDiff): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const existingIdx = session.diffs.findIndex((d) => d.filePath === diff.filePath);
    if (existingIdx >= 0) {
      session.diffs[existingIdx] = diff;
    } else {
      session.diffs.unshift(diff);
    }
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  updateSession(id: string, patch: Partial<Pick<AgentSession, 'status' | 'title' | 'cliSessionId'>>): AgentSession | null {
    const session = this.getSession(id);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return session;
  }

  createApproval(input: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'>): ApprovalRequest {
    const req: ApprovalRequest = {
      ...input,
      id: `apr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.state.approvals = [req, ...this.state.approvals];
    this.persist();
    return req;
  }

  getApproval(id: string): ApprovalRequest | undefined {
    return this.state.approvals.find((a) => a.id === id);
  }

  resolveApproval(id: string, decision: 'approved' | 'rejected', note?: string): ApprovalRequest | null {
    const req = this.getApproval(id);
    if (!req) return null;
    req.status = decision;
    req.resolvedAt = new Date().toISOString();
    if (note) req.note = note;
    this.persist();
    return req;
  }

  updateTunnelConfig(patch: Partial<TunnelConfig>): TunnelConfig {
    this.state.tunnelConfig = {
      ...this.state.tunnelConfig,
      ...patch,
    };
    this.persist();
    return this.state.tunnelConfig;
  }
}
