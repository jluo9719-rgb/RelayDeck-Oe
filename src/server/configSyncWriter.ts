import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ClaudeSyncSummary,
  CodexAuthSummary,
  CodexConfigSummary,
  ValidatedSyncPayload,
} from './configSyncLogic.ts';

export interface SyncApplyReceipt {
  syncedAt: string;
  sourceHost?: string;
  updatedFiles: string[];
  claude?: ClaudeSyncSummary;
  codexConfig?: CodexConfigSummary;
  codexAuth?: CodexAuthSummary;
}

function assertConfinedToHome(homeDir: string, targetPath: string): void {
  const resolvedHome = path.resolve(homeDir);
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedHome + path.sep)) {
    throw new Error('目标写入路径超出安全主目录范围，已拒绝写入。');
  }
}

function writeSecretFileAtomically(homeDir: string, relativeSegments: string[], content: string): void {
  const targetPath = path.resolve(homeDir, ...relativeSegments);
  assertConfinedToHome(homeDir, targetPath);

  const dir = path.dirname(targetPath);
  assertConfinedToHome(homeDir, dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  if (fs.existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak`;
    assertConfinedToHome(homeDir, backupPath);
    fs.copyFileSync(targetPath, backupPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(backupPath, 0o600);
    }
  }

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  assertConfinedToHome(homeDir, tempPath);
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, targetPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o600);
  }
}

/**
 * Applies a validated sync payload to ~/.claude/settings.json, ~/.codex/config.toml,
 * and ~/.codex/auth.json using atomic writes and 0600 permissions.
 * Returns strictly non-secret metadata suitable for API responses and logs.
 */
export function applyConfigSync(
  payload: ValidatedSyncPayload,
  targetHomeDir = os.homedir()
): SyncApplyReceipt {
  const updatedFiles: string[] = [];

  if (payload.claudeSettings) {
    writeSecretFileAtomically(
      targetHomeDir,
      ['.claude', 'settings.json'],
      payload.claudeSettings.sanitizedJson
    );
    updatedFiles.push('~/.claude/settings.json');
  }

  if (payload.codexConfig) {
    writeSecretFileAtomically(
      targetHomeDir,
      ['.codex', 'config.toml'],
      payload.codexConfig.sanitizedToml
    );
    updatedFiles.push('~/.codex/config.toml');
  }

  if (payload.codexAuth) {
    writeSecretFileAtomically(
      targetHomeDir,
      ['.codex', 'auth.json'],
      payload.codexAuth.sanitizedJson
    );
    updatedFiles.push('~/.codex/auth.json');
  }

  return {
    syncedAt: new Date().toISOString(),
    sourceHost: payload.sourceHost,
    updatedFiles,
    claude: payload.claudeSettings?.summary,
    codexConfig: payload.codexConfig?.summary,
    codexAuth: payload.codexAuth?.summary,
  };
}
