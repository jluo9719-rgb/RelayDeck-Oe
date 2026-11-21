export type MessageBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string };

export type InlineTokenKind =
  | 'text'
  | 'code'
  | 'bold'
  | 'link'
  | 'path'
  | 'english'
  | 'number';

export interface InlineToken {
  kind: InlineTokenKind;
  value: string;
}

export type CodeTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'operator'
  | 'flag'
  | 'path'
  | 'number';

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

const CODE_KEYWORDS = new Set([
  // Shell / DevOps commands
  'cd',
  'ls',
  'cat',
  'grep',
  'sed',
  'awk',
  'echo',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'chmod',
  'chown',
  'curl',
  'wget',
  'ssh',
  'scp',
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'tsx',
  'python',
  'python3',
  'pip',
  'pip3',
  'sudo',
  'systemctl',
  'docker',
  'adb',
  'claude',
  'codex',
  'cloudflared',
  'gradle',
  'java',
  // Programming language keywords
  'import',
  'export',
  'from',
  'default',
  'const',
  'let',
  'var',
  'function',
  'return',
  'async',
  'await',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'class',
  'interface',
  'type',
  'extends',
  'implements',
  'public',
  'private',
  'protected',
  'readonly',
  'def',
  'elif',
  'pass',
  'with',
  'as',
  'in',
  'not',
  'and',
  'or',
  'true',
  'false',
  'null',
  'None',
  'True',
  'False',
  'undefined',
  'val',
  'fun',
  'override',
  'object',
  'package',
]);

export function parseMessageBlocks(raw: string): MessageBlock[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MessageBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block ```lang
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)$/);
    if (fenceMatch) {
      const language = fenceMatch[1] || 'text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i += 1;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Markdown headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list (- item, * item, • item)
    if (/^([-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^([-*•])\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*•])\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list (1. item)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Paragraph (consume until blank line or structural block)
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const nextTrimmed = lines[i].trim();
      if (
        !nextTrimmed ||
        /^```/.test(nextTrimmed) ||
        /^#{1,3}\s+/.test(nextTrimmed) ||
        /^([-*•])\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

/**
 * Tokenizes prose so inline code, URLs, file paths, bold spans, and English/technical terms
 * receive rich multi-color accents instead of monotonous plain white text.
 */
export function tokenizeInlineProse(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Order matters: inline code -> bold -> URL -> file path -> English identifier/phrase -> standalone number
  const regex =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s)）\]】"'，。；：！？、]+)|((?:~\/|\/[a-zA-Z0-9._-]+|[A-Za-z]:\\)[a-zA-Z0-9._\\/-]*|[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+)+)|([A-Za-z][A-Za-z0-9_.+-]*(?:\s+[A-Za-z][A-Za-z0-9_.+-]*){0,2})|(\b\d+(?:\.\d+)?(?:%|ms|s|px|KB|MB|GB|TB|GiB)?\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      tokens.push({ kind: 'code', value: match[1].slice(1, -1) });
    } else if (match[2]) {
      tokens.push({ kind: 'bold', value: match[2].slice(2, -2) });
    } else if (match[3]) {
      tokens.push({ kind: 'link', value: match[3] });
    } else if (match[4]) {
      tokens.push({ kind: 'path', value: match[4] });
    } else if (match[5]) {
      tokens.push({ kind: 'english', value: match[5] });
    } else if (match[6]) {
      tokens.push({ kind: 'number', value: match[6] });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Lightweight multi-color syntax highlighter for shell commands and source code lines.
 */
export function tokenizeCodeLine(line: string): CodeToken[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return [{ kind: 'comment', value: line }];
  }

  const tokens: CodeToken[] = [];
  const regex =
    /(#.*$|\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(https?:\/\/[^\s"']+)|((?:~\/|\/[a-zA-Z0-9._-]+|[A-Za-z]:\\)[a-zA-Z0-9._\\/:=-]*|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b)|(--?[a-zA-Z][a-zA-Z0-9_-]*)|(&&|\|\||=>|->|===|!==|==|!=|>=|<=|\||=|>|<)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_-]*\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'plain', value: line.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      tokens.push({ kind: 'comment', value: match[1] });
    } else if (match[2]) {
      tokens.push({ kind: 'string', value: match[2] });
    } else if (match[3] || match[4]) {
      tokens.push({ kind: 'path', value: match[3] || match[4] });
    } else if (match[5]) {
      tokens.push({ kind: 'flag', value: match[5] });
    } else if (match[6]) {
      tokens.push({ kind: 'operator', value: match[6] });
    } else if (match[7]) {
      tokens.push({ kind: 'number', value: match[7] });
    } else if (match[8]) {
      const word = match[8];
      tokens.push({
        kind: CODE_KEYWORDS.has(word) ? 'keyword' : 'plain',
        value: word,
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: 'plain', value: line.slice(lastIndex) });
  }

  return tokens;
}
