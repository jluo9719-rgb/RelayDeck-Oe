import crypto from 'node:crypto';

export const MAX_CLAUDE_SETTINGS_BYTES = 128 * 1024;
export const MAX_CODEX_CONFIG_BYTES = 128 * 1024;
export const MAX_CODEX_AUTH_BYTES = 64 * 1024;

export interface ClaudeSyncSummary {
  baseUrl?: string;
  model?: string;
  hasAuthToken: boolean;
  strippedKeys: string[];
}

export interface CodexConfigSummary {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  baseUrl?: string;
  strippedKeys: string[];
  strippedSections: string[];
}

export interface CodexAuthSummary {
  keyNames: string[];
  hasOpenAiKey: boolean;
}

export interface ValidatedSyncPayload {
  claudeSettings?: {
    sanitizedJson: string;
    summary: ClaudeSyncSummary;
  };
  codexConfig?: {
    sanitizedToml: string;
    summary: CodexConfigSummary;
  };
  codexAuth?: {
    sanitizedJson: string;
    summary: CodexAuthSummary;
  };
  sourceHost?: string;
}

export type SyncValidationResult =
  | { ok: true; payload: ValidatedSyncPayload }
  | { ok: false; error: string };

const WINDOWS_PATH_OR_EXE_REGEX =
  /(?:[A-Za-z]:\\|[A-Za-z]:\/(?:Users|Program Files|Windows)|\.exe\b|\.cmd\b|\.bat\b|%USERPROFILE%|powershell(?:\.exe)?|cmd\.exe)/i;

const WINDOWS_ONLY_CODEX_KEYS = new Set([
  'model_catalog_json',
  'notify',
  'sandbox',
  'sandbox_mode',
  'windows_wsl_setup_acknowledged',
]);

/**
 * Constant-time comparison of two secret strings using SHA-256 digests so
 * neither string length nor byte prefix can leak via timing side channels.
 */
export function timingSafeSecretEquals(provided: string, expected: string): boolean {
  const cleanProvided = provided.trim();
  const cleanExpected = expected.trim();
  if (!cleanProvided || !cleanExpected) {
    return false;
  }
  const digestA = crypto.createHash('sha256').update(cleanProvided, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(cleanExpected, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function unquoteTomlValue(raw: string): string {
  const trimmed = raw.trim().replace(/\s+#.*$/, '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function countBracketDelta(line: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '#') break;
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
  }
  return depth;
}

interface TomlSection {
  header: string | null;
  sectionName: string | null;
  lines: string[];
}

/**
 * Strips Windows-only paths, executables, and incompatible sandbox/MCP entries
 * from a Windows CC Switch `~/.codex/config.toml` so Codex CLI runs cleanly on Linux.
 */
export function sanitizeCodexConfigForLinux(tomlContent: string): {
  sanitizedToml: string;
  summary: CodexConfigSummary;
} {
  const normalized = tomlContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');

  const sections: TomlSection[] = [{ header: null, sectionName: null, lines: [] }];
  for (const line of rawLines) {
    const headerMatch = line.match(/^\s*\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*(?:#.*)?$/);
    if (headerMatch) {
      sections.push({
        header: line.trim(),
        sectionName: headerMatch[1].trim(),
        lines: [],
      });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const strippedKeys: string[] = [];
  const strippedSections: string[] = [];
  const outputBlocks: string[] = [];

  let provider: string | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  const providerBaseUrls = new Map<string, string>();
  let firstBaseUrl: string | undefined;

  for (const section of sections) {
    const name = section.sectionName;

    // Drop entire Windows-only sections
    if (name && (/^windows(?:\.|$)/i.test(name) || /^shell_environment_policy$/i.test(name))) {
      strippedSections.push(name);
      continue;
    }

    // Drop Windows-bound MCP server sections (e.g. node_repl or any .exe / C:\ path)
    if (name && /^mcp_servers(?:\.|$)/i.test(name)) {
      const joined = section.lines.join('\n');
      if (WINDOWS_PATH_OR_EXE_REGEX.test(joined) || /\bnode_repl\b/i.test(name)) {
        strippedSections.push(name);
        continue;
      }
    }

    const keptLines: string[] = [];
    let skippingMultilineDepth = 0;

    for (const line of section.lines) {
      if (skippingMultilineDepth > 0) {
        skippingMultilineDepth = Math.max(0, skippingMultilineDepth + countBracketDelta(line));
        continue;
      }

      const kvMatch = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        const rawValue = kvMatch[2];
        const isWindowsKey =
          (name === null && WINDOWS_ONLY_CODEX_KEYS.has(key)) ||
          WINDOWS_PATH_OR_EXE_REGEX.test(rawValue);

        if (isWindowsKey) {
          strippedKeys.push(name ? `${name}.${key}` : key);
          const delta = countBracketDelta(rawValue);
          if (delta > 0) {
            skippingMultilineDepth = delta;
          }
          continue;
        }

        const value = unquoteTomlValue(rawValue);
        if (name === null) {
          if (key === 'model_provider') provider = value;
          if (key === 'model') model = value;
          if (key === 'model_reasoning_effort') reasoningEffort = value;
        } else if (key === 'base_url') {
          if (!firstBaseUrl) firstBaseUrl = value;
          const providerMatch = name.match(/^model_providers\.(.+)$/);
          if (providerMatch) {
            providerBaseUrls.set(providerMatch[1].replace(/^["']|["']$/g, ''), value);
          }
        }
      }

      keptLines.push(line);
    }

    if (section.header) {
      outputBlocks.push([section.header, ...keptLines].join('\n').trimEnd());
    } else if (keptLines.some((l) => l.trim().length > 0)) {
      outputBlocks.push(keptLines.join('\n').trimEnd());
    }
  }

  const sanitizedToml = `${outputBlocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;

  const resolvedBaseUrl = (provider && providerBaseUrls.get(provider)) || firstBaseUrl;

  return {
    sanitizedToml,
    summary: {
      provider,
      model,
      reasoningEffort,
      baseUrl: resolvedBaseUrl,
      strippedKeys,
      strippedSections,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and sanitizes Windows `~/.claude/settings.json` for Linux Claude Code.
 * Keeps `env` credentials/URLs/models intact while removing Windows-only hook/statusLine binaries.
 */
export function sanitizeClaudeSettingsForLinux(rawJson: string): {
  sanitizedJson: string;
  summary: ClaudeSyncSummary;
} {
  const cleaned = rawJson.replace(/^\uFEFF/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Claude settings.json 不是合法的 JSON 格式。');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Claude settings.json 顶层必须是 JSON 对象。');
  }

  const result: Record<string, unknown> = {};
  const strippedKeys: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'env' && isPlainObject(value)) {
      const cleanEnv: Record<string, unknown> = {};
      for (const [envKey, envVal] of Object.entries(value)) {
        if (typeof envVal === 'string' && WINDOWS_PATH_OR_EXE_REGEX.test(envVal)) {
          strippedKeys.push(`env.${envKey}`);
          continue;
        }
        cleanEnv[envKey] = envVal;
      }
      result.env = cleanEnv;
      continue;
    }

    const serialized = JSON.stringify(value);
    if (
      (key === 'hooks' || key === 'statusLine' || key === 'shell') &&
      typeof serialized === 'string' &&
      WINDOWS_PATH_OR_EXE_REGEX.test(serialized)
    ) {
      strippedKeys.push(key);
      continue;
    }

    result[key] = value;
  }

  const envObj = isPlainObject(result.env) ? result.env : {};
  const baseUrl =
    typeof envObj.ANTHROPIC_BASE_URL === 'string' && envObj.ANTHROPIC_BASE_URL.trim()
      ? envObj.ANTHROPIC_BASE_URL.trim()
      : undefined;
  const modelCandidate =
    envObj.ANTHROPIC_MODEL ??
    envObj.ANTHROPIC_DEFAULT_SONNET_MODEL ??
    envObj.ANTHROPIC_DEFAULT_OPUS_MODEL ??
    result.model;
  const model =
    typeof modelCandidate === 'string' && modelCandidate.trim() ? modelCandidate.trim() : undefined;
  const hasAuthToken = Boolean(
    (typeof envObj.ANTHROPIC_AUTH_TOKEN === 'string' && envObj.ANTHROPIC_AUTH_TOKEN.trim()) ||
      (typeof envObj.ANTHROPIC_API_KEY === 'string' && envObj.ANTHROPIC_API_KEY.trim())
  );

  return {
    sanitizedJson: `${JSON.stringify(result, null, 2)}\n`,
    summary: {
      baseUrl,
      model,
      hasAuthToken,
      strippedKeys,
    },
  };
}

/**
 * Validates `~/.codex/auth.json` and returns formatted JSON + non-secret key-name summary.
 */
export function validateCodexAuthJson(rawJson: string): {
  sanitizedJson: string;
  summary: CodexAuthSummary;
} {
  const cleaned = rawJson.replace(/^\uFEFF/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Codex auth.json 不是合法的 JSON 格式。');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Codex auth.json 顶层必须是 JSON 对象。');
  }

  const keyNames = Object.keys(parsed);
  const hasOpenAiKey = Boolean(
    typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.trim().length > 0
  );

  return {
    sanitizedJson: `${JSON.stringify(parsed, null, 2)}\n`,
    summary: {
      keyNames,
      hasOpenAiKey,
    },
  };
}

/**
 * Validates an incoming POST /api/sync-config request body.
 */
export function validateSyncPayload(body: unknown): SyncValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象。' };
  }

  const { claudeSettings, codexConfig, codexAuth, sourceHost } = body;

  if (
    claudeSettings === undefined &&
    codexConfig === undefined &&
    codexAuth === undefined
  ) {
    return {
      ok: false,
      error: '请至少提供 claudeSettings、codexConfig 或 codexAuth 中的一项配置。',
    };
  }

  const payload: ValidatedSyncPayload = {};

  if (typeof sourceHost === 'string' && sourceHost.trim()) {
    payload.sourceHost = sourceHost.trim().slice(0, 64);
  }

  if (claudeSettings !== undefined) {
    if (typeof claudeSettings !== 'string') {
      return { ok: false, error: 'claudeSettings 必须是字符串。' };
    }
    if (Buffer.byteLength(claudeSettings, 'utf8') > MAX_CLAUDE_SETTINGS_BYTES) {
      return { ok: false, error: 'claudeSettings 文件体积超出安全限制（128 KB）。' };
    }
    try {
      payload.claudeSettings = sanitizeClaudeSettingsForLinux(claudeSettings);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'claudeSettings 校验失败。' };
    }
  }

  if (codexConfig !== undefined) {
    if (typeof codexConfig !== 'string') {
      return { ok: false, error: 'codexConfig 必须是字符串。' };
    }
    if (Buffer.byteLength(codexConfig, 'utf8') > MAX_CODEX_CONFIG_BYTES) {
      return { ok: false, error: 'codexConfig 文件体积超出安全限制（128 KB）。' };
    }
    if (!codexConfig.trim()) {
      return { ok: false, error: 'codexConfig 内容不能为空。' };
    }
    payload.codexConfig = sanitizeCodexConfigForLinux(codexConfig);
  }

  if (codexAuth !== undefined) {
    if (typeof codexAuth !== 'string') {
      return { ok: false, error: 'codexAuth 必须是字符串。' };
    }
    if (Buffer.byteLength(codexAuth, 'utf8') > MAX_CODEX_AUTH_BYTES) {
      return { ok: false, error: 'codexAuth 文件体积超出安全限制（64 KB）。' };
    }
    try {
      payload.codexAuth = validateCodexAuthJson(codexAuth);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'codexAuth 校验失败。' };
    }
  }

  return { ok: true, payload };
}
