import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessageBlocks,
  tokenizeCodeLine,
  tokenizeInlineProse,
} from './richMessageParser';

test('parseMessageBlocks parses headings, code blocks, lists, and paragraphs', () => {
  const sample = [
    '## 1. 本机环境（一次性）',
    '',
    '```bash',
    'cd ~/Downloads && git clone https://github.com/example/repo',
    '```',
    '',
    '- 使用 `Claude Code` 驱动任务',
    '- 端口 3010 监听中',
    '',
    '1. 第一步验证',
    '2. 第二步部署',
  ].join('\n');

  const blocks = parseMessageBlocks(sample);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], { type: 'heading', level: 2, text: '1. 本机环境（一次性）' });
  assert.deepEqual(blocks[1], {
    type: 'code',
    language: 'bash',
    code: 'cd ~/Downloads && git clone https://github.com/example/repo',
  });
  assert.equal(blocks[2].type, 'list');
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].type, 'list');
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[3].items.length, 2);
});

test('tokenizeInlineProse distinguishes inline code, bold, paths, URLs, English terms, and numbers', () => {
  const tokens = tokenizeInlineProse(
    '打开 **RelayDeck** 的 `config.toml` 或访问 https://cloud.example.com，路径 /home/ubuntu/workspace，共 2 条记录'
  );

  assert.ok(tokens.some((t) => t.kind === 'bold' && t.value === 'RelayDeck'));
  assert.ok(tokens.some((t) => t.kind === 'code' && t.value === 'config.toml'));
  assert.ok(tokens.some((t) => t.kind === 'link' && t.value === 'https://cloud.example.com'));
  assert.ok(tokens.some((t) => t.kind === 'path' && t.value === '/home/ubuntu/workspace'));
  assert.ok(tokens.some((t) => t.kind === 'number' && t.value === '2'));
});

test('tokenizeCodeLine highlights shell commands, flags, strings, paths, operators, and comments', () => {
  const commentTokens = tokenizeCodeLine('# 必须是 16.x');
  assert.deepEqual(commentTokens, [{ kind: 'comment', value: '# 必须是 16.x' }]);

  const cmdTokens = tokenizeCodeLine('python3 -m pip install "frida==16.7.19" && cd ~/Downloads');
  assert.ok(cmdTokens.some((t) => t.kind === 'keyword' && t.value === 'python3'));
  assert.ok(cmdTokens.some((t) => t.kind === 'flag' && t.value === '-m'));
  assert.ok(cmdTokens.some((t) => t.kind === 'string' && t.value === '"frida==16.7.19"'));
  assert.ok(cmdTokens.some((t) => t.kind === 'operator' && t.value === '&&'));
  assert.ok(cmdTokens.some((t) => t.kind === 'keyword' && t.value === 'cd'));
  assert.ok(cmdTokens.some((t) => t.kind === 'path' && t.value === '~/Downloads'));
});
