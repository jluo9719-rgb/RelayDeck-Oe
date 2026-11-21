import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ShieldAlert, X, XCircle } from 'lucide-react';
import type { ApprovalRequest } from '../types/bridge';
import { formatRelativeTime } from '../utils/bridgeLogic';

interface ApprovalsViewProps {
  approvals: ApprovalRequest[];
  onResolve: (id: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
  onJumpToSession: (sessionId: string) => void;
}

type ApprovalFilter = 'pending' | 'approved' | 'rejected' | 'all';

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  approvals,
  onResolve,
  onJumpToSession,
}) => {
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const approvedCount = approvals.filter((a) => a.status === 'approved').length;
  const rejectedCount = approvals.filter((a) => a.status === 'rejected').length;

  const filtered = approvals.filter((item) => (filter === 'all' ? true : item.status === filter));

  const handleAction = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    try {
      await onResolve(id, decision);
    } finally {
      setBusyId(null);
    }
  };

  const renderRisk = (risk: ApprovalRequest['risk']) => {
    if (risk === 'high') {
      return (
        <span className="inline-flex items-center gap-1 font-medium text-rose-700 dark:text-rose-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          高风险命令
        </span>
      );
    }
    if (risk === 'moderate') {
      return (
        <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          需确认变更
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        低风险只读
      </span>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            手机端权限审批队列
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            当电脑端 Claude Code 或 Codex 需要执行 Shell 命令或写入文件时，请求会暂停并同步到此队列等待放行。
          </p>
        </div>

        <div className="inline-flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1 sm:self-auto dark:bg-slate-900">
          {(
            [
              { id: 'pending', label: `待处理 ${pendingCount}` },
              { id: 'approved', label: `已批准 ${approvedCount}` },
              { id: 'rejected', label: `已拒绝 ${rejectedCount}` },
              { id: 'all', label: '全部' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
            {filter === 'pending' ? '当前没有待审批的操作' : '该分类下暂无记录'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            在控制台向 Claude Code 或 Codex 下发需要修改文件或执行命令的任务后，审批卡片会实时推送到这里。
          </p>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {filtered.map((item) => {
            const isBusy = busyId === item.id;
            return (
              <article key={item.id} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-semibold ${
                        item.agent === 'claude'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {item.agent === 'claude' ? 'Claude Code' : 'OpenAI Codex'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{item.workspaceName}</span>
                    <span aria-hidden="true">·</span>
                    {renderRisk(item.risk)}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatRelativeTime(item.createdAt)}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onJumpToSession(item.sessionId)}
                    className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
                  >
                    查看对应会话
                  </button>
                </div>

                <h2 className="mt-2.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {item.summary}
                </h2>

                <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {item.command}
                </pre>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {item.status === 'pending' ? (
                    <div className="flex w-full items-center gap-2.5 sm:w-auto">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleAction(item.id, 'approved')}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 sm:flex-initial dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span>{isBusy ? '处理中…' : '批准执行'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleAction(item.id, 'rejected')}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50 sm:flex-initial dark:border-slate-700 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        <span>拒绝</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-medium">
                      {item.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          已批准放行
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          已拒绝执行
                        </span>
                      )}
                      {item.resolvedAt && (
                        <>
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-slate-500 tabular-nums dark:text-slate-400">
                            {formatRelativeTime(item.resolvedAt)}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
