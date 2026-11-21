import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizeClaudeSettingsForLinux,
  sanitizeCodexConfigForLinux,
  timingSafeSecretEquals,
  validateCodexAuthJson,
  validateSyncPayload,
} from './configSyncLogic';
import { applyConfigSync } from './configSyncWriter';

test('timingSafeSecretEquals matches identical secrets and rejects mismatches or blanks', () => {
  assert.equal(timingSafeSecretEquals('super-secret-token-1234', 'super-secret-token-1234'), true);
  assert.equal(timingSafeSecretEquals(' super-secret-token-1234 ', 'super-secret-token-1234'), true);
  assert.equal(timingSafeSecretEquals('wrong-secret', 'super-secret-token-1234'), false);
  assert.equal(timingSafeSecretEquals('', 'super-secret-token-1234'), false);
  assert.equal(timingSafeSecretEquals('super-secret-token-1234', ''), false);
  assert.equal(timingSafeSecretEquals('', ''), false);
});

test('sanitizeCodexConfigForLinux strips Windows paths/MCP entries while preserving provider & model', () => {
  const windowsToml = [
    'model_provider = "custom"',
    'model = "gpt-6.1-sol"',
    'model_reasoning_effort = "ultra"',
    `model_catalog_json = 'C:\\Users\\DevUser\\.codex\\cc-switch-model-catalog.json'`,
    'notify = [',
    `  'C:\\Users\\DevUser\\AppData\\Local\\codex-computer-use.exe',`,
    `  '--done'`,
    ']',
    'sandbox = "elevated"',
    '',
    '[model_providers.custom]',
    'name = "custom"',
    'base_url = "https://api.example-provider.com"',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
    '[mcp_servers.node_repl]',
    'command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"',
    'args = ["C:\\\\Users\\\\DevUser\\\\repl.js"]',
    '',
    '[windows]',
    'wsl = false',
  ].join('\n');

  const { sanitizedToml, summary } = sanitizeCodexConfigForLinux(windowsToml);

  assert.equal(summary.provider, 'custom');
  assert.equal(summary.model, 'gpt-6.1-sol');
  assert.equal(summary.reasoningEffort, 'ultra');
  assert.equal(summary.baseUrl, 'https://api.example-provider.com');
  assert.ok(summary.strippedKeys.includes('model_catalog_json'));
  assert.ok(summary.strippedKeys.includes('notify'));
  assert.ok(summary.strippedKeys.includes('sandbox'));
  assert.ok(summary.strippedSections.includes('mcp_servers.node_repl'));
  assert.ok(summary.strippedSections.includes('windows'));

  assert.match(sanitizedToml, /model_provider = "custom"/);
  assert.match(sanitizedToml, /model = "gpt-6\.1-sol"/);
  assert.match(sanitizedToml, /\[model_providers\.custom\]/);
  assert.match(sanitizedToml, /base_url = "https:\/\/api\.example-provider\.com"/);
  assert.doesNotMatch(sanitizedToml, /C:\\Users/);
  assert.doesNotMatch(sanitizedToml, /codex-computer-use\.exe/);
  assert.doesNotMatch(sanitizedToml, /node_repl/);
  assert.doesNotMatch(sanitizedToml, /sandbox = "elevated"/);
});

test('sanitizeClaudeSettingsForLinux keeps env credentials/URLs, strips Windows hooks, never leaks tokens in summary', () => {
  const raw = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'https://api.example.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test-secret-do-not-leak',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      WIN_HELPER: 'C:\\Tools\\helper.exe',
    },
    statusLine: {
      type: 'command',
      command: 'powershell.exe -File C:\\Users\\DevUser\\status.ps1',
    },
    alwaysThinkingEnabled: true,
  });

  const { sanitizedJson, summary } = sanitizeClaudeSettingsForLinux(raw);
  const parsed = JSON.parse(sanitizedJson) as Record<string, unknown>;
  const env = parsed.env as Record<string, string>;

  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.example.com/anthropic');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-test-secret-do-not-leak');
  assert.equal(env.WIN_HELPER, undefined);
  assert.equal(parsed.statusLine, undefined);
  assert.equal(parsed.alwaysThinkingEnabled, true);

  assert.equal(summary.baseUrl, 'https://api.example.com/anthropic');
  assert.equal(summary.model, 'claude-sonnet-4-6');
  assert.equal(summary.hasAuthToken, true);
  assert.ok(summary.strippedKeys.includes('env.WIN_HELPER'));
  assert.ok(summary.strippedKeys.includes('statusLine'));
  assert.equal(JSON.stringify(summary).includes('sk-test-secret-do-not-leak'), false);
});

test('validateCodexAuthJson validates structure without exposing secret values', () => {
  const { summary } = validateCodexAuthJson('{"OPENAI_API_KEY": "sk-secret-value-999"}');
  assert.equal(summary.hasOpenAiKey, true);
  assert.deepEqual(summary.keyNames, ['OPENAI_API_KEY']);
  assert.equal(JSON.stringify(summary).includes('sk-secret-value-999'), false);

  assert.throws(() => validateCodexAuthJson('["not-an-object"]'));
  assert.throws(() => validateCodexAuthJson('{bad-json'));
});

test('validateSyncPayload rejects empty or malformed bodies and accepts partial valid updates', () => {
  assert.equal(validateSyncPayload({}).ok, false);
  assert.equal(validateSyncPayload(null).ok, false);
  assert.equal(validateSyncPayload({ claudeSettings: '{invalid' }).ok, false);

  const partial = validateSyncPayload({
    codexConfig: 'model_provider = "custom"\nmodel = "gpt-5.4"\n',
    sourceHost: 'DEV-PC',
  });
  assert.equal(partial.ok, true);
  if (partial.ok) {
    assert.equal(partial.payload.sourceHost, 'DEV-PC');
    assert.equal(partial.payload.codexConfig?.summary.model, 'gpt-5.4');
    assert.equal(partial.payload.claudeSettings, undefined);
  }
});

test('applyConfigSync writes files atomically inside target home dir with backups and 0600 permissions', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'relaydeck-sync-test-'));
  try {
    // Seed existing config to verify backup creation
    fs.mkdirSync(path.join(tempHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(tempHome, '.codex', 'config.toml'), 'model = "old-model"\n', 'utf8');

    const validation = validateSyncPayload({
      claudeSettings: JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.example.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-test-token',
          ANTHROPIC_MODEL: 'claude-opus-4-6',
        },
      }),
      codexConfig: 'model_provider = "custom"\nmodel = "gpt-6.1-sol"\n',
      codexAuth: JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      sourceHost: 'WIN-DESKTOP',
    });

    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const receipt = applyConfigSync(validation.payload, tempHome);
    assert.deepEqual(receipt.updatedFiles, [
      '~/.claude/settings.json',
      '~/.codex/config.toml',
      '~/.codex/auth.json',
    ]);
    assert.equal(receipt.claude?.model, 'claude-opus-4-6');
    assert.equal(receipt.codexConfig?.model, 'gpt-6.1-sol');
    assert.equal(receipt.codexAuth?.hasOpenAiKey, true);

    // Verify backup preserved old model
    const backupText = fs.readFileSync(path.join(tempHome, '.codex', 'config.toml.bak'), 'utf8');
    assert.equal(backupText, 'model = "old-model"\n');

    // Verify written file contents and 0600 permissions on POSIX
    const newCodex = fs.readFileSync(path.join(tempHome, '.codex', 'config.toml'), 'utf8');
    assert.match(newCodex, /model = "gpt-6\.1-sol"/);

    if (process.platform !== 'win32') {
      const authStat = fs.statSync(path.join(tempHome, '.codex', 'auth.json'));
      assert.equal(authStat.mode & 0o777, 0o600);
      const claudeStat = fs.statSync(path.join(tempHome, '.claude', 'settings.json'));
      assert.equal(claudeStat.mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
