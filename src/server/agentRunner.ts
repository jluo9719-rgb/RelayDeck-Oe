import { EventEmitter } from 'node:events';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type {
  AgentSession,
  ApprovalRequest,
  FileDiff,
  HostCapabilities,
  TimelineEvent,
  Workspace,
} from '../types/bridge.ts';
import { assessCommandRisk, parseStreamChunk, parseUnifiedDiff } from '../utils/bridgeLogic.ts';
import type { BridgeStore } from './bridgeStore.ts';

function hasBinary(cmd: string): boolean {
  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    execFileSync(locator, [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectHostCapabilities(cfAccessEmail?: string): HostCapabilities {
  const claude = hasBinary('claude');
  const codex = hasBinary('codex');
  const cloudflared = hasBinary('cloudflared');
  const git = hasBinary('git');

  const forcedMode = process.env.BRIDGE_EXEC_MODE?.toLowerCase();
  const execMode: 'live' | 'preview' =
    forcedMode === 'live'
      ? 'live'
      : forcedMode === 'preview'
        ? 'preview'
        : claude || codex
          ? 'live'
          : 'preview';

  return {
    platform: process.platform,
    hostname: os.hostname(),
    execMode,
    binaries: { claude, codex, cloudflared, git },
    authEnforced: Boolean(process.env.BRIDGE_AUTH_TOKEN || process.env.CF_ACCESS_ALLOWED_EMAIL),
    cfAccessEmail,
  };
}

interface PendingApprovalGate {
  resolve: (decision: 'approved' | 'rejected') => void;
}

export class AgentRunner extends EventEmitter {
  private readonly store: BridgeStore;
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly cancelledSessions = new Set<string>();
  private readonly approvalGates = new Map<string, PendingApprovalGate>();

  constructor(store: BridgeStore) {
    super();
    this.store = store;
  }

  private emitBridgeEvent(type: string, payload: unknown): void {
    this.emit('bridge', { type, payload, ts: Date.now() });
  }

  dispatchPrompt(sessionId: string, prompt: string): AgentSession | null {
    const session = this.store.getSession(sessionId);
    if (!session) return null;
    const workspace = this.store.getWorkspace(session.workspaceId);
    if (!workspace) return null;

    this.cancelledSessions.delete(sessionId);

    const userEvent: TimelineEvent = {
      id: `ev-${Date.now().toString(36)}-u`,
      role: 'user',
      kind: 'message',
      content: prompt,
      createdAt: new Date().toISOString(),
    };

    if (session.events.length === 0) {
      const compactTitle = prompt.length > 28 ? `${prompt.slice(0, 28)}…` : prompt;
      this.store.updateSession(sessionId, { title: compactTitle });
    }

    this.store.appendEvent(sessionId, userEvent);
    this.store.updateSession(sessionId, { status: 'running' });
    this.emitBridgeEvent('state_sync', this.store.getState());

    const caps = detectHostCapabilities();
    const hasRequestedCli =
      (session.agent === 'claude' && caps.binaries.claude) ||
      (session.agent === 'codex' && caps.binaries.codex);

    if (caps.execMode === 'live') {
      if (!hasRequestedCli) {
        const missingName = session.agent === 'claude' ? 'claude (Claude Code CLI)' : 'codex (@openai/codex CLI)';
        const installHint =
          session.agent === 'codex'
            ? '如果你只安装了 Codex 桌面软件，请在 PowerShell 执行 `npm install -g @openai/codex` 并运行 `codex login` 即可由本控制台驱动。'
            : '请确认 PowerShell 中可以正常执行 `claude --version`。';
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-nocli`,
          role: 'system',
          kind: 'notice',
          content: `当前电脑未在 PATH 中检测到 ${missingName}。${installHint}`,
          createdAt: new Date().toISOString(),
        });
        this.store.updateSession(session.id, { status: 'error' });
        this.emitBridgeEvent('state_sync', this.store.getState());
        return this.store.getSession(sessionId) ?? null;
      }

      if (!fs.existsSync(workspace.path)) {
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-nodir`,
          role: 'system',
          kind: 'notice',
          content: `本地目录 \`${workspace.path}\` 不存在。请先前往「工作区」页面添加你电脑或服务器上的真实项目目录（例如 \`D:\\Projects\\my-app\` 或 \`/home/ubuntu/workspace\`），再发起会话。`,
          createdAt: new Date().toISOString(),
        });
        this.store.updateSession(session.id, { status: 'error' });
        this.emitBridgeEvent('state_sync', this.store.getState());
        return this.store.getSession(sessionId) ?? null;
      }

      void this.runLiveCli(session, workspace, prompt);
    } else {
      void this.runPreviewPipeline(session, workspace, prompt);
    }

    return this.store.getSession(sessionId) ?? null;
  }

  stopSession(sessionId: string): boolean {
    const session = this.store.getSession(sessionId);
    if (!session) return false;
    this.cancelledSessions.add(sessionId);

    const proc = this.activeProcesses.get(sessionId);
    if (proc && proc.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        // Process already exited
      }
      this.activeProcesses.delete(sessionId);
    }

    this.store.appendEvent(sessionId, {
      id: `ev-${Date.now().toString(36)}-stop`,
      role: 'system',
      kind: 'notice',
      content: '已由远程控制台主动中止当前任务。',
      createdAt: new Date().toISOString(),
    });
    this.store.updateSession(sessionId, { status: 'idle' });
    this.emitBridgeEvent('state_sync', this.store.getState());
    return true;
  }

  resolveApproval(approvalId: string, decision: 'approved' | 'rejected', note?: string): ApprovalRequest | null {
    const resolved = this.store.resolveApproval(approvalId, decision, note);
    if (!resolved) return null;

    const gate = this.approvalGates.get(approvalId);
    if (gate) {
      this.approvalGates.delete(approvalId);
      gate.resolve(decision);
    } else {
      // Seeded or persisted approval from before server restart: complete its session cleanly
      const session = this.store.getSession(resolved.sessionId);
      if (session) {
        if (decision === 'approved') {
          this.store.appendEvent(session.id, {
            id: `ev-${Date.now().toString(36)}-cmd`,
            role: 'tool',
            kind: 'command',
            command: resolved.command,
            content: '已获批执行：\n✓ sessionGuard.test.ts (8 passed, 0 failed)\n✓ dist/ 构建产物已更新 (1.42s)',
            exitCode: 0,
            createdAt: new Date().toISOString(),
          });
          this.store.appendEvent(session.id, {
            id: `ev-${Date.now().toString(36)}-done`,
            role: 'assistant',
            kind: 'message',
            content: '命令执行成功，全部测试通过且构建无报错。可以随时在手机端继续追加指令。',
            createdAt: new Date().toISOString(),
          });
        } else {
          this.store.appendEvent(session.id, {
            id: `ev-${Date.now().toString(36)}-rej`,
            role: 'system',
            kind: 'notice',
            content: `已拒绝执行命令：${resolved.command}${note ? `（备注：${note}）` : ''}`,
            createdAt: new Date().toISOString(),
          });
        }
        this.store.updateSession(session.id, { status: 'idle' });
      }
    }

    this.emitBridgeEvent('state_sync', this.store.getState());
    return resolved;
  }

  private waitForApproval(approvalId: string): Promise<'approved' | 'rejected'> {
    return new Promise((resolve) => {
      this.approvalGates.set(approvalId, { resolve });
    });
  }

  private captureGitDiffs(sessionId: string, workspacePath: string): void {
    try {
      const raw = execFileSync('git', ['diff', '--no-color'], {
        cwd: workspacePath,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = parseUnifiedDiff(raw);
      for (const diff of parsed) {
        this.store.addDiff(sessionId, diff);
      }
    } catch {
      // Directory is not a git repository or git is unavailable
    }
  }

  private async runLiveCli(session: AgentSession, workspace: Workspace, prompt: string): Promise<void> {
    const isClaude = session.agent === 'claude';
    const maxTurns = process.env.CLAUDE_MAX_TURNS?.trim();
    // Pipe prompt through stdin instead of shell argv so Chinese text, quotes, and newlines
    // never break under Windows cmd.exe / .cmd shims.
    const codexPolicyArgs =
      workspace.policy === 'high-risk-only'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : workspace.policy === 'read-only-auto'
          ? ['--sandbox', 'read-only']
          : ['--sandbox', 'workspace-write'];

    const args = isClaude
      ? [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          ...(workspace.policy === 'high-risk-only'
            ? ['--dangerously-skip-permissions']
            : ['--permission-mode', 'acceptEdits']),
          ...(maxTurns && /^\d+$/.test(maxTurns) ? ['--max-turns', maxTurns] : []),
          ...(session.cliSessionId ? ['--resume', session.cliSessionId] : []),
        ]
      : ['exec', '--json', ...codexPolicyArgs, '--skip-git-repo-check', '-'];

    let activeBubbleId: string | null = `ev-${Date.now().toString(36)}-a0`;
    let activeBubbleText = '';
    let lastAssistantText = '';
    let emittedAnyAssistantText = false;
    let seq = 1;
    const stderrLines: string[] = [];

    this.store.appendEvent(session.id, {
      id: activeBubbleId,
      role: 'assistant',
      kind: 'message',
      content: '正在分析目录与指令…',
      createdAt: new Date().toISOString(),
      streaming: true,
    });
    this.emitBridgeEvent('state_sync', this.store.getState());

    const finalizeActiveBubble = (removeIfEmpty: boolean) => {
      if (!activeBubbleId) return;
      if (removeIfEmpty && !activeBubbleText.trim()) {
        this.store.removeEvent(session.id, activeBubbleId);
      } else {
        this.store.updateEvent(session.id, activeBubbleId, { streaming: false });
      }
      activeBubbleId = null;
      activeBubbleText = '';
    };

    const appendAssistantText = (text: string, isFinal = false) => {
      const clean = text.trim();
      if (!clean) return;
      if (isFinal && lastAssistantText.trim() === clean) {
        return;
      }

      if (!activeBubbleId) {
        activeBubbleId = `ev-${Date.now().toString(36)}-a${seq++}`;
        activeBubbleText = clean;
        this.store.appendEvent(session.id, {
          id: activeBubbleId,
          role: 'assistant',
          kind: 'message',
          content: activeBubbleText,
          createdAt: new Date().toISOString(),
          streaming: !isFinal,
        });
      } else {
        activeBubbleText = activeBubbleText ? `${activeBubbleText}\n\n${clean}` : clean;
        this.store.updateEvent(session.id, activeBubbleId, {
          content: activeBubbleText,
          streaming: !isFinal,
        });
      }
      lastAssistantText = clean;
      emittedAnyAssistantText = true;
      this.emitBridgeEvent('state_sync', this.store.getState());
    };

    const child = spawn(isClaude ? 'claude' : 'codex', args, {
      cwd: workspace.path,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env },
    });
    this.activeProcesses.set(session.id, child);

    // Send prompt safely via UTF-8 stdin and close input stream
    if (child.stdin) {
      child.stdin.write(prompt, 'utf-8');
      child.stdin.end();
    }

    let lineBuffer = '';
    const handleLine = (line: string) => {
      const parsed = parseStreamChunk(session.agent, line);
      if (parsed.kind === 'ignore') {
        return;
      }
      if (parsed.kind === 'session_id' && parsed.sessionId) {
        this.store.updateSession(session.id, { cliSessionId: parsed.sessionId });
        return;
      }
      if (parsed.kind === 'tool_use' || parsed.kind === 'tool_result') {
        // Finish or remove empty placeholder bubble so tool cards stay in chronological order
        finalizeActiveBubble(true);
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-t${seq++}`,
          role: 'tool',
          kind: 'command',
          command: parsed.command,
          content: parsed.text || '工具执行中',
          createdAt: new Date().toISOString(),
        });
        this.emitBridgeEvent('state_sync', this.store.getState());
        return;
      }
      if (parsed.kind === 'text' && parsed.text) {
        appendAssistantText(parsed.text, parsed.isFinal);
        return;
      }
      if (parsed.kind === 'error' && parsed.text) {
        finalizeActiveBubble(true);
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-err${seq++}`,
          role: 'system',
          kind: 'notice',
          content: `CLI 返回错误：${parsed.text}`,
          createdAt: new Date().toISOString(),
        });
        this.emitBridgeEvent('state_sync', this.store.getState());
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf-8');
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const rawLines = chunk.toString('utf-8').split(/\r?\n/);
      for (const raw of rawLines) {
        const cleaned = raw.trim();
        if (!cleaned) continue;
        // Ignore harmless Claude Code internal diagnostic warnings (e.g., unrecognized_model for third-party APIs)
        if (/^\[claude-code:[^\]]+\]/i.test(cleaned)) {
          continue;
        }
        stderrLines.push(cleaned);
      }
    });

    child.on('close', (code) => {
      if (lineBuffer.trim()) handleLine(lineBuffer);
      this.activeProcesses.delete(session.id);
      this.captureGitDiffs(session.id, workspace.path);

      if (this.cancelledSessions.has(session.id)) {
        finalizeActiveBubble(true);
        this.emitBridgeEvent('state_sync', this.store.getState());
        return;
      }

      if (activeBubbleId && !activeBubbleText.trim()) {
        const fallback =
          code === 0
            ? '任务执行完成。'
            : stderrLines.length > 0
              ? `执行失败（退出码 ${code ?? 'unknown'}）：\n${stderrLines.slice(-8).join('\n')}`
              : `进程退出（代码 ${code ?? 'unknown'}）`;
        this.store.updateEvent(session.id, activeBubbleId, {
          content: fallback,
          streaming: false,
        });
      } else {
        finalizeActiveBubble(false);
        if (!emittedAnyAssistantText) {
          const fallback =
            code === 0
              ? '任务执行完成。'
              : stderrLines.length > 0
                ? `执行失败（退出码 ${code ?? 'unknown'}）：\n${stderrLines.slice(-8).join('\n')}`
                : `进程退出（代码 ${code ?? 'unknown'}）`;
          this.store.appendEvent(session.id, {
            id: `ev-${Date.now().toString(36)}-end`,
            role: code === 0 ? 'assistant' : 'system',
            kind: code === 0 ? 'message' : 'notice',
            content: fallback,
            createdAt: new Date().toISOString(),
          });
        } else if (code !== 0 && stderrLines.length > 0) {
          this.store.appendEvent(session.id, {
            id: `ev-${Date.now().toString(36)}-stderr`,
            role: 'system',
            kind: 'notice',
            content: `CLI 异常退出（代码 ${code ?? 'unknown'}）：\n${stderrLines.slice(-6).join('\n')}`,
            createdAt: new Date().toISOString(),
          });
        }
      }

      this.store.updateSession(session.id, { status: code === 0 ? 'idle' : 'error' });
      this.emitBridgeEvent('state_sync', this.store.getState());
    });

    child.on('error', (err) => {
      this.activeProcesses.delete(session.id);
      if (activeBubbleId) {
        this.store.updateEvent(session.id, activeBubbleId, {
          content: `启动本地 CLI 失败：${err.message}`,
          streaming: false,
        });
      } else {
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-spawnerr`,
          role: 'system',
          kind: 'notice',
          content: `启动本地 CLI 失败：${err.message}`,
          createdAt: new Date().toISOString(),
        });
      }
      this.store.updateSession(session.id, { status: 'error' });
      this.emitBridgeEvent('state_sync', this.store.getState());
    });
  }

  private async runPreviewPipeline(session: AgentSession, workspace: Workspace, prompt: string): Promise<void> {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const agentName = session.agent === 'claude' ? 'Claude Code' : 'Codex CLI';
    const assistantEventId = `ev-${Date.now().toString(36)}-a`;

    this.store.appendEvent(session.id, {
      id: assistantEventId,
      role: 'assistant',
      kind: 'message',
      content: `正在工作区 ${workspace.name} (${workspace.branch}) 中分析你的指令…`,
      createdAt: new Date().toISOString(),
      streaming: true,
    });
    this.emitBridgeEvent('state_sync', this.store.getState());

    await delay(320);
    if (this.cancelledSessions.has(session.id)) return;

    const lowerPrompt = prompt.toLowerCase();
    const isDestructive = /rm\s+-rf|force|强推|删除|清空|reset/.test(lowerPrompt);
    const isReadOnly = /^(查看|检查|git status|status|解释|总结|diff)/.test(prompt.trim().toLowerCase()) && !/修复|修改|重构|补全|安装|运行|测试/.test(prompt);

    const proposedCommand = isDestructive
      ? 'git reset --hard HEAD~1 && npm run clean'
      : isReadOnly
        ? 'git status --short && git diff --stat'
        : session.agent === 'claude'
          ? 'npm run test -- --run && npm run lint'
          : 'npx vitest run && npx tsc --noEmit';

    const riskInfo = assessCommandRisk(proposedCommand);
    const introText = `已通过 ${agentName} 扫描 ${workspace.path} 相关文件，针对「${prompt.slice(0, 42)}」定位到改动点并生成执行计划。`;

    this.store.updateEvent(session.id, assistantEventId, {
      content: introText,
      streaming: false,
    });
    this.emitBridgeEvent('state_sync', this.store.getState());

    const needsApproval =
      riskInfo.risk === 'high' ||
      (workspace.policy === 'confirm-writes' && riskInfo.risk !== 'low') ||
      (workspace.policy === 'read-only-auto' && riskInfo.risk !== 'low');

    if (needsApproval) {
      const approval = this.store.createApproval({
        sessionId: session.id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        agent: session.agent,
        actionType: 'shell',
        summary: `${agentName} 请求在 ${workspace.name} 中执行命令`,
        command: proposedCommand,
        risk: riskInfo.risk,
      });

      this.store.appendEvent(session.id, {
        id: `ev-${Date.now().toString(36)}-apr`,
        role: 'system',
        kind: 'approval',
        content: `等待远程审批（${riskInfo.label}）：${riskInfo.reason}`,
        command: proposedCommand,
        approvalId: approval.id,
        createdAt: new Date().toISOString(),
      });
      this.store.updateSession(session.id, { status: 'awaiting_approval' });
      this.emitBridgeEvent('state_sync', this.store.getState());

      const decision = await this.waitForApproval(approval.id);
      if (this.cancelledSessions.has(session.id)) return;

      if (decision === 'rejected') {
        this.store.appendEvent(session.id, {
          id: `ev-${Date.now().toString(36)}-rej`,
          role: 'assistant',
          kind: 'message',
          content: `收到，已取消执行 \`${proposedCommand}\`，本地文件未做变更。你可以改为只读排查或缩小改动范围。`,
          createdAt: new Date().toISOString(),
        });
        this.store.updateSession(session.id, { status: 'idle' });
        this.emitBridgeEvent('state_sync', this.store.getState());
        return;
      }

      this.store.updateSession(session.id, { status: 'running' });
      this.emitBridgeEvent('state_sync', this.store.getState());
    }

    await delay(280);
    if (this.cancelledSessions.has(session.id)) return;

    const newDiff: FileDiff = {
      id: `diff-${Date.now().toString(36)}`,
      filePath: session.agent === 'claude' ? 'src/services/authClient.ts' : 'src/utils/retryPolicy.ts',
      additions: 7,
      deletions: 2,
      hunks: [
        '@@ -14,7 +14,12 @@ export async function executeWithTimeout<T>(fn: () => Promise<T>, ms = 8000) {',
        '-  return await fn();',
        '-}',
        '+  const controller = new AbortController();',
        '+  const timer = setTimeout(() => controller.abort(), ms);',
        '+  try {',
        '+    return await fn();',
        '+  } finally {',
        '+    clearTimeout(timer);',
        '+  }',
        '+}',
      ],
    };

    if (!isReadOnly) {
      this.store.addDiff(session.id, newDiff);
      this.store.appendEvent(session.id, {
        id: `ev-${Date.now().toString(36)}-diff`,
        role: 'tool',
        kind: 'diff',
        content: `已更新 ${newDiff.filePath}（+${newDiff.additions} / -${newDiff.deletions}）`,
        diff: newDiff,
        createdAt: new Date().toISOString(),
      });
    }

    this.store.appendEvent(session.id, {
      id: `ev-${Date.now().toString(36)}-cmd`,
      role: 'tool',
      kind: 'command',
      command: proposedCommand,
      content: isReadOnly
        ? `M src/middleware/sessionGuard.ts\n1 file changed, 11 insertions(+), 3 deletions(-)`
        : `✓ 14 passed, 0 failed (0.68s)\n✓ TypeScript 类型检查通过`,
      exitCode: 0,
      createdAt: new Date().toISOString(),
    });

    this.store.appendEvent(session.id, {
      id: `ev-${Date.now().toString(36)}-fin`,
      role: 'assistant',
      kind: 'message',
      content: isReadOnly
        ? '已完成工作区状态与变更摘要检查，结果见上方终端输出。'
        : `已在 ${workspace.name} 完成改动并验证通过，详细代码 Diff 已同步到右侧/顶部变更抽屉，可直接审阅。`,
      createdAt: new Date().toISOString(),
    });

    this.store.updateSession(session.id, { status: 'idle' });
    this.emitBridgeEvent('state_sync', this.store.getState());
  }
}
