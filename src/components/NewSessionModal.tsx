import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { AgentKind, Workspace } from '../types/bridge';

interface NewSessionModalProps {
  open: boolean;
  workspaces: Workspace[];
  defaultWorkspaceId?: string;
  onClose: () => void;
  onCreate: (payload: {
    workspaceId: string;
    agent: AgentKind;
    title: string;
    initialPrompt: string;
  }) => Promise<void>;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  open,
  workspaces,
  defaultWorkspaceId,
  onClose,
  onCreate,
}) => {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId || workspaces[0]?.id || '');
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [title, setTitle] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const selectedWsId = workspaces.some((w) => w.id === workspaceId)
    ? workspaceId
    : workspaces[0]?.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWsId) {
      setError('请先在「工作区」页面添加至少一个 Windows 本地项目目录。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onCreate({
        workspaceId: selectedWsId,
        agent,
        title: title.trim(),
        initialPrompt: initialPrompt.trim(),
      });
      setTitle('');
      setInitialPrompt('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会话失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-session-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white p-6 shadow-xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden dark:bg-slate-700" aria-hidden="true" />
        <div className="flex items-center justify-between gap-4">
          <h2 id="new-session-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            新建智能体会话
          </h2>
          <button
            type="button"
            aria-label="关闭新建会话弹窗"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="session-workspace" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              目标 Windows 工作区
            </label>
            <select
              id="session-workspace"
              value={selectedWsId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({ws.path})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              选择本地智能体 CLI
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setAgent('claude')}
                className={`min-h-[44px] rounded-md px-3 text-sm font-medium transition-colors ${
                  agent === 'claude'
                    ? 'bg-white text-amber-800 shadow-sm dark:bg-slate-800 dark:text-amber-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Claude Code
              </button>
              <button
                type="button"
                onClick={() => setAgent('codex')}
                className={`min-h-[44px] rounded-md px-3 text-sm font-medium transition-colors ${
                  agent === 'codex'
                    ? 'bg-white text-emerald-800 shadow-sm dark:bg-slate-800 dark:text-emerald-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                OpenAI Codex
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="session-title" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              任务标题（可选）
            </label>
            <input
              id="session-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：修复支付回调超时重试"
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="session-prompt" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              首条下发指令（可选）
            </label>
            <textarea
              id="session-prompt"
              rows={3}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="直接输入需求，创建后将立即派发给电脑端智能体执行…"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {submitting ? '正在创建…' : '创建会话'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
