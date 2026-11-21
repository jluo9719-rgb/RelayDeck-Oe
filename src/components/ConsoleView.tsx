import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  FileDiff as FileDiffIcon,
  FolderOpen,
  Plus,
  Send,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AgentKind,
  AgentSession,
  ApprovalRequest,
  HostCapabilities,
  Workspace,
} from '../types/bridge';
import { formatRelativeTime } from '../utils/bridgeLogic';
import {
  ANIME_WALLPAPER_URL,
  isDarkTheme,
  type ThemeId,
} from '../utils/themeConfig';
import { DiffViewer } from './DiffViewer';
import { HighlightedCodeLine, RichMessageContent } from './RichMessageContent';
import { StarfieldCanvas } from './StarfieldCanvas';
import { ThemeSwitcher } from './ThemeSwitcher';

interface ConsoleViewProps {
  workspaces: Workspace[];
  sessions: AgentSession[];
  approvals: ApprovalRequest[];
  activeSessionId: string | null;
  hostCaps: HostCapabilities | null;
  themeId: ThemeId;
  starfieldEnabled: boolean;
  onSelectTheme: (id: ThemeId) => void;
  onToggleStarfield: () => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => Promise<void>;
  onSendMessage: (sessionId: string, prompt: string) => Promise<void>;
  onStopSession: (sessionId: string) => Promise<void>;
  onResolveApproval: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  onOpenTunnelSetup: () => void;
}

const QUICK_PROMPTS = [
  '查看当前 git status 与未提交变更摘要',
  '运行核心单元测试并修复失败用例',
  '检查鉴权超时与异常处理边界',
];

export const ConsoleView: React.FC<ConsoleViewProps> = ({
  workspaces,
  sessions,
  approvals,
  activeSessionId,
  hostCaps,
  themeId,
  starfieldEnabled,
  onSelectTheme,
  onToggleStarfield,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onSendMessage,
  onStopSession,
  onResolveApproval,
  onOpenTunnelSetup,
}) => {
  const [agentFilter, setAgentFilter] = useState<'all' | AgentKind>('all');
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState('');
  const [sending, setSending] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showMobileSessions, setShowMobileSessions] = useState(false);
  const [showDiffDrawer, setShowDiffDrawer] = useState(false);
  const [wallpaperFailed, setWallpaperFailed] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const isDark = isDarkTheme(themeId);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  const activeWorkspace = activeSession
    ? workspaces.find((w) => w.id === activeSession.workspaceId)
    : undefined;

  const filteredSessions = sessions.filter((s) =>
    agentFilter === 'all' ? true : s.agent === agentFilter
  );

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeSession?.id, activeSession?.events.length]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeSession) return;
    const clean = draft.trim();
    if (!clean) {
      setComposerError('请输入要发给智能体的任务指令。');
      return;
    }
    setComposerError('');
    setSending(true);
    try {
      await onSendMessage(activeSession.id, clean);
      setDraft('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : '指令发送失败，请重试。');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleInlineResolve = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setResolvingId(approvalId);
    try {
      await onResolveApproval(approvalId, decision);
    } finally {
      setResolvingId(null);
    }
  };

  const renderSessionStatus = (status: AgentSession['status']) => {
    switch (status) {
      case 'running':
        return <span className="whitespace-nowrap shrink-0 font-medium text-blue-700 dark:text-blue-400">执行中</span>;
      case 'awaiting_approval':
        return <span className="whitespace-nowrap shrink-0 font-medium text-amber-700 dark:text-amber-400">待审批</span>;
      case 'error':
        return <span className="whitespace-nowrap shrink-0 font-medium text-rose-700 dark:text-rose-400">异常</span>;
      default:
        return <span className="whitespace-nowrap shrink-0 text-slate-500 dark:text-slate-400">就绪</span>;
    }
  };

  const renderSessionList = (onPicked?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'claude', label: 'Claude' },
              { id: 'codex', label: 'Codex' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setAgentFilter(item.id)}
              className={`min-h-[34px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                agentFilter === item.id
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
        {filteredSessions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>暂无匹配的会话</p>
            <button
              type="button"
              onClick={() => {
                onPicked?.();
                onNewSession();
              }}
              className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              新建会话
            </button>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const ws = workspaces.find((w) => w.id === session.workspaceId);
            const selected = activeSession?.id === session.id;
            return (
              <div
                key={session.id}
                className={`group flex items-start gap-2 px-3.5 py-3 transition-colors ${
                  selected
                    ? 'bg-slate-100/90 dark:bg-slate-800/70'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectSession(session.id);
                    onPicked?.();
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span
                      className={`font-semibold ${
                        session.agent === 'claude'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {session.agent === 'claude' ? 'Claude' : 'Codex'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate font-mono">{ws?.name ?? '未知目录'}</span>
                    <span aria-hidden="true">·</span>
                    {renderSessionStatus(session.status)}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {session.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                    {formatRelativeTime(session.updatedAt)} · {session.events.length} 条记录
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`删除会话 ${session.title}`}
                  onClick={() => void onDeleteSession(session.id)}
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-70 transition-opacity hover:bg-slate-200 hover:text-rose-700 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {hostCaps && (
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {hostCaps.execMode === 'live' ? '本机实机模式' : '云端交互预览模式'}
            </span>
            <button
              type="button"
              onClick={() => {
                onPicked?.();
                onOpenTunnelSetup();
              }}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Windows 接入
            </button>
          </div>
          <p className="mt-1 leading-relaxed text-[11px] text-slate-500 dark:text-slate-400">
            {hostCaps.execMode === 'live'
              ? `已检测到本地 CLI，正在 ${hostCaps.platform} 宿主机直接驱动会话。`
              : '部署到你的 Windows 电脑后，将自动切换为实机调用本地 claude / codex CLI。'}
          </p>
        </div>
      )}
    </div>
  );

  const cardSurfaceClass =
    themeId === 'anime'
      ? 'border-violet-300/20 bg-[#070a14]/56 backdrop-blur-[6px] shadow-lg shadow-black/25'
      : themeId === 'cyber'
        ? 'border-violet-400/20 bg-[#0b1020]/76 backdrop-blur-md shadow-lg shadow-black/20'
        : themeId === 'obsidian'
          ? 'border-slate-700/70 bg-slate-900/75 backdrop-blur-md shadow-lg shadow-black/20'
          : 'border-slate-200 bg-white';

  const userBubbleClass = isDark
    ? 'border border-violet-400/35 bg-gradient-to-br from-violet-950/78 via-indigo-950/76 to-slate-900/78 text-violet-50 backdrop-blur-md shadow-lg shadow-violet-950/35'
    : 'bg-slate-900 text-white';

  return (
    <div className="mx-auto flex h-[calc(100dvh-112px)] max-w-[1440px] flex-col overflow-hidden md:h-[calc(100dvh-64px)] md:flex-row">
      {/* Desktop Left Sidebar */}
      <aside
        aria-label="会话列表"
        className="hidden min-h-0 w-[272px] shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col dark:border-slate-800 dark:bg-slate-950"
      >
        {renderSessionList()}
      </aside>

      {/* Main Conversation & Execution Pane */}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/60 dark:bg-[#060812]">
        {/* Atmospheric Theme Backdrop Layer */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {themeId === 'anime' && (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-[#05070e] via-[#100d1f] to-[#061314]" />
              {!wallpaperFailed && (
                <img
                  src={ANIME_WALLPAPER_URL}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setWallpaperFailed(true)}
                  className="h-full w-full object-cover object-[center_18%] opacity-78 transition-opacity duration-500"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-[#05070e]/45 via-[#070a15]/24 to-[#05070e]/68" />
            </>
          )}

          {themeId === 'cyber' && (
            <>
              <div className="absolute inset-0 bg-[#060914]" />
              <div className="cyber-dot-grid absolute inset-0 opacity-75" />
              <div
                className={`absolute -top-28 left-1/2 h-80 w-[34rem] -translate-x-1/2 rounded-full blur-3xl transition-colors duration-500 ${
                  activeSession?.agent === 'claude'
                    ? 'bg-gradient-to-r from-violet-600/25 via-amber-500/20 to-fuchsia-600/20'
                    : 'bg-gradient-to-r from-violet-600/25 via-cyan-500/20 to-emerald-500/20'
                }`}
              />
            </>
          )}

          {themeId === 'obsidian' && (
            <>
              <div className="absolute inset-0 bg-gradient-to-b from-[#080c18] via-[#0d1224] to-[#090d1a]" />
              <div className="absolute -right-24 top-1/4 h-96 w-96 rounded-full bg-violet-600/12 blur-3xl" />
              <div className="absolute -left-24 bottom-1/4 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
            </>
          )}

          <StarfieldCanvas
            enabled={isDark && starfieldEnabled}
            tint={
              themeId === 'cyber'
                ? activeSession?.agent === 'claude'
                  ? 'amber'
                  : 'cyan'
                : 'violet'
            }
          />
        </div>

        {/* Session Context Bar */}
        <div className="relative z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-md md:px-6 dark:border-violet-400/15 dark:bg-[#090d1a]/82">
          {activeSession ? (
            <>
              <button
                type="button"
                onClick={() => setShowMobileSessions(true)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left md:pointer-events-none"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span
                      className={`font-semibold whitespace-nowrap ${
                        activeSession.agent === 'claude'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {activeSession.agent === 'claude' ? 'Claude Code' : 'OpenAI Codex'}
                    </span>
                    <span aria-hidden="true">/</span>
                    <span className="truncate font-mono text-slate-700 dark:text-slate-300">
                      {activeWorkspace?.name ?? '未绑定工作区'}
                    </span>
                    {activeWorkspace?.branch && (
                      <>
                        <span aria-hidden="true" className="hidden sm:inline">·</span>
                        <span className="hidden font-mono text-slate-500 sm:inline dark:text-slate-400">
                          {activeWorkspace.branch}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    {renderSessionStatus(activeSession.status)}
                  </div>
                  <h1 className="mt-0.5 truncate text-sm font-semibold text-slate-900 md:text-base dark:text-slate-100">
                    {activeSession.title}
                  </h1>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 md:hidden" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <ThemeSwitcher
                  themeId={themeId}
                  starfieldEnabled={starfieldEnabled}
                  onSelectTheme={onSelectTheme}
                  onToggleStarfield={onToggleStarfield}
                />
                <button
                  type="button"
                  onClick={() => setShowDiffDrawer(true)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 xl:hidden dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <FileDiffIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="tabular-nums">变更 ({activeSession.diffs.length})</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full items-center justify-between gap-2 py-1">
              <span className="text-sm text-slate-500 dark:text-slate-400">尚未选择会话</span>
              <div className="flex items-center gap-2">
                <ThemeSwitcher
                  themeId={themeId}
                  starfieldEnabled={starfieldEnabled}
                  onSelectTheme={onSelectTheme}
                  onToggleStarfield={onToggleStarfield}
                />
                <button
                  type="button"
                  onClick={onNewSession}
                  className="text-sm font-medium text-violet-600 hover:underline dark:text-purple-400"
                >
                  新建会话
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stream Timeline */}
        <div className="relative z-10 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {!activeSession ? (
            <div className="mx-auto mt-12 max-w-md text-center">
              <Terminal className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" />
              <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                开始远程控制你的智能体
              </h2>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                选择一个 Windows 本地工作区，启动 Claude Code 或 Codex CLI 会话。
              </p>
              <button
                type="button"
                onClick={onNewSession}
                className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建会话
              </button>
            </div>
          ) : activeSession.events.length === 0 ? (
            <div className={`mx-auto mt-8 max-w-xl rounded-2xl border p-6 ${cardSurfaceClass}`}>
              <p className="font-mono text-xs font-medium text-sky-700 dark:text-cyan-300/90">
                {activeSession.modelLabel} · {activeWorkspace?.path}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                会话已就绪，输入你的任务指令
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300/90">
                电脑端将在指定项目目录下运行该智能体；涉及修改文件或执行 Shell 命令时，会按工作区策略向手机推送审批请求。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setDraft(tpl)}
                    className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-violet-400/20 dark:bg-slate-950/70 dark:text-violet-200 dark:hover:bg-violet-950/50"
                  >
                    {tpl}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {activeSession.events.map((ev) => {
                if (ev.role === 'user') {
                  return (
                    <div key={ev.id} className="flex justify-end">
                      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${userBubbleClass}`}>
                        <p className="whitespace-pre-wrap">{ev.content}</p>
                        <p className="mt-1.5 text-right text-[11px] text-slate-400 tabular-nums dark:text-violet-300/75">
                          手机端指令 · {formatRelativeTime(ev.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                }

                if (ev.kind === 'approval' && ev.approvalId) {
                  const req = approvals.find((a) => a.id === ev.approvalId);
                  const isPending = req?.status === 'pending';
                  const isBusy = resolvingId === ev.approvalId;

                  return (
                    <div
                      key={ev.id}
                      className="rounded-xl border border-amber-300/90 bg-amber-50/80 p-4 backdrop-blur-md dark:border-amber-500/40 dark:bg-amber-950/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-amber-900 dark:text-amber-300">
                          {isPending
                            ? '等待远程审批确认'
                            : req?.status === 'approved'
                              ? '已批准执行'
                              : '已拒绝此操作'}
                        </span>
                        <span className="text-amber-800/70 tabular-nums dark:text-amber-400/70">
                          {formatRelativeTime(ev.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-800 dark:text-slate-100">{ev.content}</p>
                      {ev.command && (
                        <pre className="mt-2.5 overflow-x-auto rounded-lg border border-amber-200/80 bg-white px-3 py-2 font-mono text-xs dark:border-amber-700/40 dark:bg-[#070a15]/85">
                          <HighlightedCodeLine line={ev.command} />
                        </pre>
                      )}

                      {isPending && (
                        <div className="mt-3.5 flex items-center gap-2.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleInlineResolve(ev.approvalId!, 'approved')}
                            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:flex-initial dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            <span>{isBusy ? '执行中…' : '批准执行'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleInlineResolve(ev.approvalId!, 'rejected')}
                            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 sm:flex-initial dark:border-slate-700 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            <span>拒绝</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                if (ev.kind === 'command') {
                  return (
                    <div
                      key={ev.id}
                      className={`overflow-hidden rounded-xl border p-4 ${cardSurfaceClass}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-medium text-sky-700 dark:text-cyan-300">
                          工具与终端步骤
                          {typeof ev.exitCode === 'number' ? ` · 退出码 ${ev.exitCode}` : ''}
                        </span>
                        <span className="tabular-nums">{formatRelativeTime(ev.createdAt)}</span>
                      </div>
                      {ev.command && (
                        <p className="mt-2 break-all font-mono text-xs leading-5">
                          <span className="mr-1.5 font-semibold text-pink-500 dark:text-pink-400">$</span>
                          <HighlightedCodeLine line={ev.command} />
                        </p>
                      )}
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50/95 p-3 font-mono text-xs leading-5 dark:border dark:border-violet-400/15 dark:bg-[#060913]/85">
                        {ev.content.split('\n').map((line, lineIdx) => (
                          <div key={lineIdx} className="min-h-[1.25rem]">
                            <HighlightedCodeLine line={line} />
                          </div>
                        ))}
                      </pre>
                    </div>
                  );
                }

                if (ev.kind === 'diff' && ev.diff) {
                  return (
                    <div
                      key={ev.id}
                      className={`rounded-xl border p-4 ${cardSurfaceClass}`}
                    >
                      <p className="mb-2 text-xs font-medium text-sky-700 dark:text-cyan-300">
                        文件补丁 · {formatRelativeTime(ev.createdAt)}
                      </p>
                      <DiffViewer diffs={[ev.diff]} compact />
                    </div>
                  );
                }

                return (
                  <div
                    key={ev.id}
                    className={`overflow-hidden rounded-xl border px-4 py-3.5 ${cardSurfaceClass}`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span
                        className={`font-semibold ${
                          ev.role === 'system'
                            ? 'text-violet-700 dark:text-purple-300'
                            : activeSession.agent === 'claude'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {ev.role === 'system' ? 'Bridge 系统消息' : activeSession.modelLabel}
                      </span>
                      <span className="tabular-nums">
                        {ev.streaming ? '正在输出…' : formatRelativeTime(ev.createdAt)}
                      </span>
                    </div>
                    <RichMessageContent content={ev.content} />
                  </div>
                );
              })}
              <div ref={timelineEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Prompt Composer */}
        {activeSession && (
          <form
            onSubmit={handleSubmit}
            className="relative z-20 shrink-0 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-md md:px-6 md:py-3 dark:border-violet-400/15 dark:bg-[#090d1a]/88"
          >
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="agent-prompt-input" className="sr-only">
                    输入下发给智能体的指令
                  </label>
                  <textarea
                    id="agent-prompt-input"
                    rows={1}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      if (composerError) setComposerError('');
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={`向 ${activeSession.agent === 'claude' ? 'Claude Code' : 'Codex CLI'} 发指令…`}
                    className="min-h-[44px] w-full resize-none rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:outline-none md:min-h-[48px] dark:border-violet-400/25 dark:bg-[#060914]/90 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-purple-400 dark:focus:bg-[#060914]"
                  />
                </div>

                {activeSession.status === 'running' ? (
                  <button
                    type="button"
                    aria-label="中止当前任务"
                    onClick={() => void onStopSession(activeSession.id)}
                    className="inline-flex h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-700 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-800 md:h-[48px]"
                  >
                    <Square className="h-4 w-4" aria-hidden="true" />
                    <span>中止</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={sending}
                    className="inline-flex h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 md:h-[48px] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>{sending ? '发送中' : '发送'}</span>
                  </button>
                )}
              </div>

              {composerError && (
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
                  {composerError}
                </p>
              )}
            </div>
          </form>
        )}
      </section>

      {/* Desktop Right Inspector (Diffs & Workspace Context) */}
      <aside
        aria-label="变更审阅面板"
        className="hidden min-h-0 w-[380px] shrink-0 border-l border-slate-200 bg-white xl:flex xl:flex-col dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            会话变更与目录上下文
          </h2>
          {activeWorkspace && (
            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{activeWorkspace.path}</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <DiffViewer diffs={activeSession?.diffs ?? []} compact />
        </div>
      </aside>

      {/* Mobile Session Switcher Sheet */}
      {showMobileSessions && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="切换智能体会话"
          className="fixed inset-0 z-50 flex items-end bg-slate-950/50 md:hidden"
          onClick={() => setShowMobileSessions(false)}
        >
          <div
            className="flex h-[75dvh] w-full flex-col rounded-t-3xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">切换智能体会话</h2>
              <button
                type="button"
                aria-label="关闭会话抽屉"
                onClick={() => setShowMobileSessions(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{renderSessionList(() => setShowMobileSessions(false))}</div>
          </div>
        </div>
      )}

      {/* Mobile & Tablet Diff Drawer */}
      {showDiffDrawer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="查看代码变更"
          className="fixed inset-0 z-50 flex items-end bg-slate-950/50 xl:hidden"
          onClick={() => setShowDiffDrawer(false)}
        >
          <div
            className="flex h-[78dvh] w-full flex-col rounded-t-3xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  代码变更 ({activeSession?.diffs.length ?? 0})
                </h2>
                {activeWorkspace && (
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{activeWorkspace.path}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="关闭代码变更抽屉"
                onClick={() => setShowDiffDrawer(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DiffViewer diffs={activeSession?.diffs ?? []} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
