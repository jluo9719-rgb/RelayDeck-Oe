import React, { useState } from 'react';
import { FolderGit2, Plus, Trash2 } from 'lucide-react';
import type { AgentKind, PermissionPolicy, Workspace } from '../types/bridge';
import { formatRelativeTime, validateWorkspaceInput } from '../utils/bridgeLogic';

interface WorkspacesViewProps {
  workspaces: Workspace[];
  onCreate: (payload: {
    name: string;
    path: string;
    branch: string;
    defaultAgent: AgentKind;
    policy: PermissionPolicy;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: Partial<{ defaultAgent: AgentKind; policy: PermissionPolicy }>
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLaunchSession: (workspaceId: string, agent: AgentKind) => Promise<void>;
}

const POLICY_LABELS: Record<PermissionPolicy, string> = {
  'confirm-writes': '所有写入与命令需手机审批',
  'read-only-auto': '只读命令自动放行，修改需审批',
  'high-risk-only': '仅高危删除/强推命令需审批',
};

export const WorkspacesView: React.FC<WorkspacesViewProps> = ({
  workspaces,
  onCreate,
  onUpdate,
  onDelete,
  onLaunchSession,
}) => {
  const [name, setName] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [branch, setBranch] = useState('main');
  const [defaultAgent, setDefaultAgent] = useState<AgentKind>('claude');
  const [policy, setPolicy] = useState<PermissionPolicy>('confirm-writes');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateWorkspaceInput(name, dirPath);
    if (!check.valid) {
      setError(check.error);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await onCreate({
        name: check.normalizedName,
        path: check.normalizedPath,
        branch: branch.trim() || 'main',
        defaultAgent,
        policy,
      });
      setName('');
      setDirPath('');
      setBranch('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加工作区失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-10">
      <div className="border-b border-slate-200 pb-6 dark:border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Windows 本地工作区白名单
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          只允许 Claude Code 与 Codex CLI 在这里显式授权的目录内运行，禁止越权访问系统目录。
        </p>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-12">
        {/* Left: Workspace list */}
        <div className="lg:col-span-7">
          {workspaces.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-800 dark:bg-slate-900">
              <FolderGit2 className="mx-auto h-9 w-9 text-slate-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                尚未配置任何项目目录
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                在右侧表单填入你的 Windows 本地代码路径（如 D:\Projects\my-app）即可开始使用。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {workspaces.map((ws) => (
                <div key={ws.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {ws.name}
                      </h2>
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                        {ws.path}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        分支 {ws.branch} · 最近活跃 {formatRelativeTime(ws.lastActiveAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`移除工作区 ${ws.name}`}
                      onClick={() => void onDelete(ws.id)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-700 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`policy-${ws.id}`}
                        className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      >
                        手机审批策略
                      </label>
                      <select
                        id={`policy-${ws.id}`}
                        value={ws.policy}
                        onChange={(e) =>
                          void onUpdate(ws.id, { policy: e.target.value as PermissionPolicy })
                        }
                        className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                      >
                        {(Object.keys(POLICY_LABELS) as PermissionPolicy[]).map((key) => (
                          <option key={key} value={key}>
                            {POLICY_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => void onLaunchSession(ws.id, 'claude')}
                        className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 dark:border-slate-700 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/40 whitespace-nowrap"
                      >
                        启动 Claude
                      </button>
                      <button
                        type="button"
                        onClick={() => void onLaunchSession(ws.id, 'codex')}
                        className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40 whitespace-nowrap"
                      >
                        启动 Codex
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Add new workspace form */}
        <div className="lg:col-span-5">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              新增受控项目目录
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              支持 Windows 盘符路径（如 D:\Projects\app）与 WSL 路径（\\wsl.localhost\Ubuntu\...）。
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="ws-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  项目名称
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：ai-gateway"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="ws-path" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Windows 绝对路径
                </label>
                <input
                  id="ws-path"
                  type="text"
                  value={dirPath}
                  onChange={(e) => setDirPath(e.target.value)}
                  placeholder="D:\Projects\ai-gateway"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ws-branch" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    当前分支
                  </label>
                  <input
                    id="ws-branch"
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label htmlFor="ws-agent" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    默认智能体
                  </label>
                  <select
                    id="ws-agent"
                    value={defaultAgent}
                    onChange={(e) => setDefaultAgent(e.target.value as AgentKind)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="claude">Claude Code</option>
                    <option value="codex">OpenAI Codex</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ws-policy" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  默认审批策略
                </label>
                <select
                  id="ws-policy"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as PermissionPolicy)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {(Object.keys(POLICY_LABELS) as PermissionPolicy[]).map((key) => (
                    <option key={key} value={key}>
                      {POLICY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{submitting ? '保存中…' : '添加到白名单'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
