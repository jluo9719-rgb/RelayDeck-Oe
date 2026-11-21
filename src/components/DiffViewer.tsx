import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import type { FileDiff } from '../types/bridge';

interface DiffViewerProps {
  diffs: FileDiff[];
  compact?: boolean;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diffs, compact = false }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (diffs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        当前会话暂无未提交的代码变更。
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      {diffs.map((diff) => {
        const isClosed = Boolean(collapsed[diff.id]);
        return (
          <div key={diff.id} className={compact ? 'py-3 first:pt-0 last:pb-0' : 'py-4 first:pt-0 last:pb-0'}>
            <button
              type="button"
              aria-expanded={!isClosed}
              onClick={() => setCollapsed((prev) => ({ ...prev, [diff.id]: !prev[diff.id] }))}
              className="flex min-h-[40px] w-full items-center justify-between gap-3 text-left transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              <div className="flex min-w-0 items-center gap-2">
                {isClosed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <FileCode2 className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                <span className="truncate font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                  {diff.filePath}
                </span>
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                <span className="text-emerald-700 dark:text-emerald-400">+{diff.additions}</span>
                <span className="mx-1 text-slate-300 dark:text-slate-700">/</span>
                <span className="text-rose-700 dark:text-rose-400">-{diff.deletions}</span>
              </span>
            </button>

            {!isClosed && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 font-mono text-[12px] leading-5 dark:border-violet-400/20 dark:bg-[#060913]/72">
                {diff.hunks.map((line, idx) => {
                  const isAdd = line.startsWith('+') && !line.startsWith('+++');
                  const isDel = line.startsWith('-') && !line.startsWith('---');
                  const isMeta = line.startsWith('@@');
                  return (
                    <div
                      key={`${diff.id}-${idx}`}
                      className={`px-3 py-0.5 whitespace-pre ${
                        isAdd
                          ? 'bg-emerald-500/12 text-emerald-900 dark:bg-emerald-500/16 dark:text-emerald-300'
                          : isDel
                            ? 'bg-rose-500/12 text-rose-900 dark:bg-rose-500/16 dark:text-rose-300'
                            : isMeta
                              ? 'bg-slate-200/70 text-slate-600 dark:bg-violet-950/45 dark:text-purple-300'
                              : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
