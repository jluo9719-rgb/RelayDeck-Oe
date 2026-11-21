import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  parseMessageBlocks,
  tokenizeCodeLine,
  tokenizeInlineProse,
  type CodeTokenKind,
} from '../utils/richMessageParser';

const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  plain: 'text-slate-800 dark:text-slate-200',
  comment: 'italic text-slate-500 dark:text-slate-400/80',
  string: 'text-amber-700 dark:text-amber-300',
  keyword: 'font-medium text-violet-700 dark:text-purple-400',
  operator: 'font-medium text-rose-600 dark:text-pink-400',
  flag: 'text-emerald-700 dark:text-emerald-300',
  path: 'text-sky-700 dark:text-cyan-300',
  number: 'text-amber-700 tabular-nums dark:text-yellow-300',
};

export const HighlightedCodeLine: React.FC<{ line: string }> = ({ line }) => {
  const tokens = tokenizeCodeLine(line);
  return (
    <>
      {tokens.map((token, idx) => (
        <span key={idx} className={CODE_TOKEN_CLASS[token.kind]}>
          {token.value}
        </span>
      ))}
    </>
  );
};

const renderInlineTokens = (text: string) => {
  const tokens = tokenizeInlineProse(text);
  return tokens.map((token, idx) => {
    switch (token.kind) {
      case 'code':
        return (
          <code
            key={idx}
            className="mx-0.5 rounded-md border border-violet-200/90 bg-violet-50 px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-violet-700 dark:border-violet-400/25 dark:bg-violet-500/15 dark:text-violet-300"
          >
            {token.value}
          </code>
        );
      case 'bold':
        return (
          <strong
            key={idx}
            className="font-semibold text-slate-900 dark:text-fuchsia-200"
          >
            {token.value}
          </strong>
        );
      case 'link':
        return (
          <a
            key={idx}
            href={token.value}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-[13px] text-sky-700 underline decoration-sky-400/60 underline-offset-2 hover:text-sky-600 dark:text-cyan-300 dark:decoration-cyan-400/50 dark:hover:text-cyan-200"
          >
            {token.value}
          </a>
        );
      case 'path':
        return (
          <span
            key={idx}
            className="break-all font-mono text-[13px] text-sky-700 underline decoration-sky-400/40 underline-offset-2 dark:text-sky-300 dark:decoration-sky-400/35"
          >
            {token.value}
          </span>
        );
      case 'english':
        return (
          <span
            key={idx}
            className="font-medium text-violet-700 dark:text-purple-300"
          >
            {token.value}
          </span>
        );
      case 'number':
        return (
          <span
            key={idx}
            className="font-mono text-[13px] font-medium tabular-nums text-amber-700 dark:text-amber-300"
          >
            {token.value}
          </span>
        );
      default:
        return <React.Fragment key={idx}>{token.value}</React.Fragment>;
    }
  });
};

const CodeBlockCard: React.FC<{ language: string; code: string }> = ({
  language,
  code,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement('textarea');
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const lines = code.split('\n');

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-50/95 dark:border-violet-400/20 dark:bg-[#070a15]/85">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-3 py-1.5 text-[11px] dark:border-violet-400/15">
        <span className="font-mono font-medium text-violet-700 dark:text-violet-300/90">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-violet-500/20 dark:hover:text-violet-200"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-xs leading-6">
        <code>
          {lines.map((line, lineIdx) => (
            <div key={lineIdx} className="min-h-[1.25rem]">
              <HighlightedCodeLine line={line} />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};

interface RichMessageContentProps {
  content: string;
}

export const RichMessageContent: React.FC<RichMessageContentProps> = ({ content }) => {
  const blocks = parseMessageBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2.5 break-words text-sm leading-relaxed text-slate-800 dark:text-slate-100/95">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1
              ? 'text-base font-bold'
              : block.level === 2
                ? 'text-[15px] font-semibold'
                : 'text-sm font-semibold';
          return (
            <h3
              key={idx}
              className={`${sizeClass} pt-1 tracking-tight text-sky-700 dark:text-sky-400`}
            >
              {renderInlineTokens(block.text)}
            </h3>
          );
        }

        if (block.type === 'code') {
          return <CodeBlockCard key={idx} language={block.language} code={block.code} />;
        }

        if (block.type === 'list') {
          if (block.ordered) {
            return (
              <ol key={idx} className="space-y-1.5 pl-1">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold tabular-nums text-sky-600 dark:text-cyan-400">
                      {itemIdx + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{renderInlineTokens(item)}</span>
                  </li>
                ))}
              </ol>
            );
          }

          return (
            <ul key={idx} className="space-y-1.5 pl-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 font-mono text-xs font-bold text-violet-600 dark:text-purple-400"
                  >
                    •
                  </span>
                  <span className="min-w-0 flex-1">{renderInlineTokens(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={idx} className="whitespace-pre-wrap">
            {renderInlineTokens(block.text)}
          </p>
        );
      })}
    </div>
  );
};
