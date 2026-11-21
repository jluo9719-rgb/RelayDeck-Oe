import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCommandRisk,
  checkDomainCompatibility,
  formatRelativeTime,
  generateTunnelArtifacts,
  parseStreamChunk,
  parseUnifiedDiff,
  validateWorkspaceInput,
} from './bridgeLogic';

test('validateWorkspaceInput accepts valid Windows, WSL, and POSIX paths', () => {
  const win = validateWorkspaceInput('后端服务', 'D:\\Projects\\relay-api');
  assert.equal(win.valid, true);
  if (win.valid) {
    assert.equal(win.normalizedName, '后端服务');
    assert.equal(win.normalizedPath, 'D:\\Projects\\relay-api');
  }

  const wsl = validateWorkspaceInput('WSL Repo', '\\\\wsl.localhost\\Ubuntu\\home\\dev\\app');
  assert.equal(wsl.valid, true);

  const posix = validateWorkspaceInput('Linux App', '/home/dev/projects/app');
  assert.equal(posix.valid, true);
});

test('validateWorkspaceInput rejects empty, relative, traversal, and system root paths', () => {
  assert.equal(validateWorkspaceInput('', 'D:\\Code\\a').valid, false);
  assert.equal(validateWorkspaceInput('App', 'relative/path').valid, false);
  assert.equal(validateWorkspaceInput('App', 'D:\\Code\\..\\Windows').valid, false);
  assert.equal(validateWorkspaceInput('System', 'C:\\Windows\\System32').valid, false);
  assert.equal(validateWorkspaceInput('Root', '/').valid, false);
});

test('assessCommandRisk accurately separates low, moderate, and high risk commands', () => {
  assert.equal(assessCommandRisk('git status').risk, 'low');
  assert.equal(assessCommandRisk('npm test').risk, 'low');
  assert.equal(assessCommandRisk('npm install zod').risk, 'moderate');
  assert.equal(assessCommandRisk('rm -rf ./dist').risk, 'high');
  assert.equal(assessCommandRisk('git push origin main --force').risk, 'high');
  assert.equal(assessCommandRisk('del /s /q C:\\temp').risk, 'high');
});

test('checkDomainCompatibility flags DuckDNS as incompatible and ggff.net as compatible with Cloudflare', () => {
  const duck = checkDomainCompatibility('demo-host.duckdns.org');
  assert.equal(duck.compatible, false);
  assert.match(duck.reason, /NS/);

  const ggff = checkDomainCompatibility('DemoUser.ggff.net');
  assert.equal(ggff.compatible, true);
  assert.equal(ggff.domain, 'demouser.ggff.net');
  assert.match(ggff.recommendation, /agent\.demouser\.ggff\.net/);
});

test('parseStreamChunk extracts text, tool calls, and session IDs for Claude and Codex', () => {
  const claudeSys = parseStreamChunk('claude', JSON.stringify({ type: 'system', session_id: 'sess_abc123' }));
  assert.equal(claudeSys.kind, 'session_id');
  assert.equal(claudeSys.sessionId, 'sess_abc123');

  const claudeTool = parseStreamChunk(
    'claude',
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    })
  );
  assert.equal(claudeTool.kind, 'tool_use');
  assert.equal(claudeTool.command, 'npm test');

  const codexMsg = parseStreamChunk(
    'codex',
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '已修复超时逻辑并通过 12 项单元测试。' },
    })
  );
  assert.equal(codexMsg.kind, 'text');
  assert.match(codexMsg.text ?? '', /12 项单元测试/);
});

test('parseStreamChunk ignores Claude thinking, user tool_result dumps, and diagnostic banners', () => {
  assert.equal(
    parseStreamChunk('claude', '[claude-code:unrecognized_model] {"model":"deepseek-v4-flash","query_source":"sdk"}')
      .kind,
    'ignore'
  );

  assert.equal(
    parseStreamChunk(
      'claude',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'Let me inspect the repo...' }] },
      })
    ).kind,
    'ignore'
  );

  assert.equal(
    parseStreamChunk(
      'claude',
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'huge file contents...' }] },
      })
    ).kind,
    'ignore'
  );

  const readTool = parseStreamChunk(
    'claude',
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'D:/python projects/agent/RAG/step2_embedding.py' } }],
      },
    })
  );
  assert.equal(readTool.kind, 'tool_use');
  assert.equal(readTool.text, '调用工具 Read');
  assert.equal(readTool.command, 'D:/python projects/agent/RAG/step2_embedding.py');

  const finalResult = parseStreamChunk(
    'claude',
    JSON.stringify({ type: 'result', result: '这是一个基于 Python 的 RAG 练习项目。' })
  );
  assert.equal(finalResult.kind, 'text');
  assert.equal(finalResult.isFinal, true);
  assert.match(finalResult.text ?? '', /RAG/);
});

test('generateTunnelArtifacts builds hostname, PowerShell script, and env file cleanly', () => {
  const out = generateTunnelArtifacts({
    rootDomain: 'example.ggff.net',
    subdomain: 'agent',
    tunnelName: 'win-pc-relay',
    localPort: 3000,
    allowedEmail: 'you@example.com',
    authToken: 'rdk_testtoken123',
    keepAwake: true,
    windowsBridgeDir: 'D:\\Tools\\relaydeck',
  });

  assert.equal(out.fullHostname, 'agent.example.ggff.net');
  assert.match(out.powershellScript, /cloudflared tunnel run win-pc-relay/);
  assert.match(out.powershellScript, /powercfg \/change standby-timeout-ac 0/);
  assert.match(out.envFile, /CF_ACCESS_ALLOWED_EMAIL=you@example\.com/);
  assert.match(out.cloudflaredYaml, /hostname: agent\.example\.ggff\.net/);
  assert.equal(out.dnsChecklist.length, 6);
});

test('formatRelativeTime formats seconds, minutes, hours, and days', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  assert.equal(formatRelativeTime('2026-11-20T11:59:40.000Z', now), '刚刚');
  assert.equal(formatRelativeTime('2026-11-20T11:45:00.000Z', now), '15 分钟前');
  assert.equal(formatRelativeTime('2026-11-20T09:00:00.000Z', now), '3 小时前');
  assert.equal(formatRelativeTime('2026-11-18T12:00:00.000Z', now), '2 天前');
});

test('parseUnifiedDiff parses git diff output into FileDiff entries', () => {
  const sample = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    '-const a = 1;',
    '+const a = 2;',
    '+const b = 3;',
  ].join('\n');

  const diffs = parseUnifiedDiff(sample);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].filePath, 'src/app.ts');
  assert.equal(diffs[0].additions, 2);
  assert.equal(diffs[0].deletions, 1);
  assert.equal(diffs[0].hunks[0], '@@ -1,3 +1,4 @@');
});

