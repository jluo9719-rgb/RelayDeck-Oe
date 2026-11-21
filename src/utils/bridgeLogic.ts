import type {
  AgentKind,
  DomainCompatibility,
  ParsedStreamOutput,
  RiskLevel,
  TunnelConfig,
} from '../types/bridge.ts';

const DANGEROUS_ROOTS = [
  /^c:\\windows(\\|$)/i,
  /^c:\\program files/i,
  /^c:\\system32/i,
  /^\/(etc|usr|bin|sbin|var|root|system)?\/?$/i,
];

const HIGH_RISK_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sfq]/i,
  /\brmdir\s+\/s\b/i,
  /\bremove-item\b.*-recurse/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdrop\s+(table|database)\b/i,
  /\bshutdown\b/i,
  /\breg\s+delete\b/i,
];

const READ_ONLY_PATTERNS = [
  /^\s*git\s+(status|diff|log|branch|show)\b/i,
  /^\s*(ls|dir|pwd|cat|type|head|tail|findstr|rg|grep)\b/i,
  /^\s*(npm|pnpm|yarn)\s+(test|run\s+lint|run\s+typecheck)\b/i,
  /^\s*(pytest|vitest|jest|tsc\s+--noemit)\b/i,
  /^\s*node\s+--test\b/i,
];

export function validateWorkspaceInput(
  name: string,
  rawPath: string
): { valid: true; normalizedName: string; normalizedPath: string } | { valid: false; error: string } {
  const normalizedName = name.trim();
  const normalizedPath = rawPath.trim();

  if (!normalizedName) {
    return { valid: false, error: '请输入工作区名称（例如：后端接口服务）。' };
  }
  if (normalizedName.length > 48) {
    return { valid: false, error: '工作区名称不能超过 48 个字符。' };
  }
  if (!normalizedPath) {
    return { valid: false, error: '请输入本地项目目录路径（例如：D:\\Projects\\my-app）。' };
  }

  const isWindowsDrive = /^[a-zA-Z]:\\/.test(normalizedPath);
  const isWslUnc = /^\\\\wsl(\.localhost|\$)\\/i.test(normalizedPath);
  const isPosixAbs = normalizedPath.startsWith('/');

  if (!isWindowsDrive && !isWslUnc && !isPosixAbs) {
    return {
      valid: false,
      error: '路径必须为绝对路径，支持 Windows 路径（如 D:\\Projects\\app）、WSL 路径或 Linux 绝对路径。',
    };
  }

  if (normalizedPath.includes('..')) {
    return { valid: false, error: '为保证安全，目录路径不允许包含上级跳转符号（..）。' };
  }

  for (const blocked of DANGEROUS_ROOTS) {
    if (blocked.test(normalizedPath)) {
      return { valid: false, error: '禁止直接挂载系统关键目录或根目录作为智能体工作区。' };
    }
  }

  return { valid: true, normalizedName, normalizedPath };
}

export function assessCommandRisk(command: string): { risk: RiskLevel; label: string; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { risk: 'low', label: '低风险', reason: '空命令' };
  }

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        risk: 'high',
        label: '高风险',
        reason: '包含破坏性删除、强推或系统级修改指令，必须人工二次确认。',
      };
    }
  }

  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        risk: 'low',
        label: '低风险',
        reason: '只读检查、差异查看或测试校验类命令。',
      };
    }
  }

  return {
    risk: 'moderate',
    label: '需确认',
    reason: '可能写入文件、安装依赖或变更本地环境状态。',
  };
}

function summarizeToolInput(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (typeof input.command === 'string' && input.command.trim()) {
    return input.command.trim();
  }
  if (typeof input.file_path === 'string' && input.file_path.trim()) {
    return input.file_path.trim();
  }
  if (typeof input.path === 'string' && input.path.trim()) {
    const pattern = typeof input.pattern === 'string' && input.pattern.trim() ? ` (${input.pattern.trim()})` : '';
    return `${input.path.trim()}${pattern}`;
  }
  if (typeof input.pattern === 'string' && input.pattern.trim()) {
    return input.pattern.trim();
  }
  if (typeof input.description === 'string' && input.description.trim()) {
    return input.description.trim();
  }
  return name ? undefined : undefined;
}

export function parseStreamChunk(agent: AgentKind, rawLine: string): ParsedStreamOutput {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return { kind: 'ignore' };
  }

  // Filter Claude Code internal diagnostic banners (e.g. unrecognized custom model warnings)
  if (/^\[claude-code:[^\]]+\]/i.test(trimmed)) {
    return { kind: 'ignore' };
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;

      if (data.type === 'system') {
        if (typeof data.session_id === 'string') {
          return { kind: 'session_id', sessionId: data.session_id };
        }
        return { kind: 'ignore' };
      }

      if (agent === 'claude') {
        if (data.type === 'assistant' && data.message && typeof data.message === 'object') {
          const msg = data.message as {
            content?: Array<{
              type?: string;
              text?: string;
              name?: string;
              input?: Record<string, unknown>;
            }>;
          };
          const blocks = Array.isArray(msg.content) ? msg.content : [];
          const toolBlock = blocks.find((b) => b.type === 'tool_use');
          if (toolBlock) {
            const toolName = toolBlock.name ?? 'tool';
            return {
              kind: 'tool_use',
              text: `调用工具 ${toolName}`,
              command: summarizeToolInput(toolName, toolBlock.input),
            };
          }
          const text = blocks
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('\n')
            .trim();
          if (text) {
            return { kind: 'text', text };
          }
          // Ignore thinking-only or empty assistant frames
          return { kind: 'ignore' };
        }

        // Ignore raw tool_result / file dump frames echoed back as user role in stream-json
        if (data.type === 'user') {
          return { kind: 'ignore' };
        }

        if (data.type === 'result') {
          if (data.is_error === true && typeof data.result === 'string' && data.result.trim()) {
            return { kind: 'error', text: data.result.trim() };
          }
          if (typeof data.result === 'string' && data.result.trim()) {
            return { kind: 'text', text: data.result.trim(), isFinal: true };
          }
          return { kind: 'ignore' };
        }

        if (data.type === 'error') {
          const errMsg =
            typeof data.error === 'string'
              ? data.error
              : typeof (data.error as { message?: unknown } | undefined)?.message === 'string'
                ? ((data.error as { message: string }).message)
                : typeof data.message === 'string'
                  ? data.message
                  : 'Claude CLI 返回未知错误';
          return { kind: 'error', text: errMsg };
        }

        // Any other structured Claude stream-json protocol frame should never leak raw JSON
        return { kind: 'ignore' };
      }

      if (agent === 'codex') {
        if (data.type === 'thread.started' && typeof data.thread_id === 'string') {
          return { kind: 'session_id', sessionId: data.thread_id };
        }
        if (data.type === 'item.completed' && data.item && typeof data.item === 'object') {
          const item = data.item as {
            type?: string;
            text?: string;
            command?: string;
            aggregated_output?: string;
          };
          if (item.type === 'agent_message' && item.text) {
            return { kind: 'text', text: item.text };
          }
          if (item.type === 'command_execution') {
            const rawOut = item.aggregated_output || '命令执行完成';
            const compactOut = rawOut.length > 1200 ? `${rawOut.slice(0, 1200)}\n…（输出过长已折叠）` : rawOut;
            return {
              kind: 'tool_result',
              command: item.command,
              text: compactOut,
            };
          }
          return { kind: 'ignore' };
        }
        if (data.type === 'error' && typeof data.message === 'string') {
          return { kind: 'error', text: data.message };
        }
        if (data.type === 'turn.failed') {
          const errObj = data.error as { message?: unknown } | undefined;
          const msg = typeof errObj?.message === 'string' ? errObj.message : 'Codex 执行失败';
          return { kind: 'error', text: msg };
        }
        return { kind: 'ignore' };
      }

      return { kind: 'ignore' };
    } catch {
      return { kind: 'text', text: trimmed };
    }
  }

  return { kind: 'text', text: trimmed };
}

export function checkDomainCompatibility(rawDomain: string): DomainCompatibility {
  const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!domain || !domain.includes('.') || /\s/.test(domain)) {
    return {
      domain,
      compatible: false,
      providerHint: '格式无效',
      reason: '请输入完整域名（例如 example.com 或 yourname.ggff.net）。',
      recommendation: '建议使用支持自定义 NS 记录的域名接入 Cloudflare。',
    };
  }

  if (domain.endsWith('.duckdns.org') || domain === 'duckdns.org') {
    return {
      domain,
      compatible: false,
      providerHint: 'DuckDNS（动态 DNS）',
      reason: 'DuckDNS 不支持修改 NS 记录，无法将域名解析权托管给 Cloudflare DNS，因此不能直接绑定 Cloudflare Tunnel 与 Access。',
      recommendation: '保留 DuckDNS 给原有 VPS / frp 服务使用；本控制台请改用独立域名或支持 NS 托管的二级域名接入 Cloudflare。',
    };
  }

  if (domain.endsWith('.ggff.net')) {
    return {
      domain,
      compatible: true,
      providerHint: 'L53.NET / Public Suffix 域名',
      reason: 'ggff.net 已收录在 Public Suffix List（公共后缀列表），可直接在 L53 后台将 Nameserver 修改为 Cloudflare 分配的 NS，免费开启 Tunnel 与 Zero Trust Access。',
      recommendation: `推荐分配子域名 agent.${domain} 作为手机端专属 PWA 控制台入口。`,
    };
  }

  return {
    domain,
    compatible: true,
    providerHint: '独立自定义域名',
    reason: '标准独立域名支持将 NS 记录托管至 Cloudflare，完整兼容 Cloudflare Tunnel 与 Zero Trust Access 邮箱验证码保护。',
    recommendation: `建议添加子域名 agent.${domain} 指向本地 Windows Bridge 端口。`,
  };
}

export function generateSecureToken(length = 32): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'rdk_';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * alphabet.length);
    result += alphabet[idx];
  }
  return result;
}

export function generateTunnelArtifacts(config: TunnelConfig): {
  fullHostname: string;
  envFile: string;
  cloudflaredYaml: string;
  powershellScript: string;
  dnsChecklist: string[];
} {
  const cleanRoot = config.rootDomain.trim().toLowerCase() || 'example.com';
  const cleanSub = config.subdomain.trim().toLowerCase() || 'agent';
  const fullHostname = cleanSub.includes('.') ? cleanSub : `${cleanSub}.${cleanRoot}`;
  const port = Number.isFinite(config.localPort) && config.localPort > 0 ? config.localPort : 3000;
  const tunnelName = config.tunnelName.trim() || 'windows-agent-bridge';
  const bridgeDir = config.windowsBridgeDir.trim() || 'D:\\Tools\\relaydeck';

  const envFile = [
    `PORT=${port}`,
    `BRIDGE_EXEC_MODE=live`,
    `BRIDGE_AUTH_TOKEN=${config.authToken}`,
    `CF_ACCESS_ALLOWED_EMAIL=${config.allowedEmail.trim()}`,
    `BRIDGE_DATA_DIR=.bridge-data`,
  ].join('\n');

  const cloudflaredYaml = [
    `tunnel: ${tunnelName}`,
    `credentials-file: C:\\Users\\$env:USERNAME\\.cloudflared\\<TUNNEL-UUID>.json`,
    ``,
    `ingress:`,
    `  - hostname: ${fullHostname}`,
    `    service: http://127.0.0.1:${port}`,
    `    originRequest:`,
    `      noTLSVerify: true`,
    `      keepAliveTimeout: 90s`,
    `  - service: http_status:404`,
  ].join('\n');

  const keepAwakeBlock = config.keepAwake
    ? [
        `# 防止 Windows 休眠导致手机端断联（需要管理员权限，或手动在电源计划设置从不睡眠）`,
        `powercfg /change standby-timeout-ac 0`,
        `powercfg /change hibernate-timeout-ac 0`,
        ``,
      ]
    : [];

  const powershellScript = [
    `# RelayDeck Windows 本地启动脚本 (PowerShell)`,
    `$ErrorActionPreference = "Stop"`,
    `Set-Location "${bridgeDir}"`,
    ``,
    ...keepAwakeBlock,
    `# 1. 检查本地依赖与 CLI`,
    `Write-Host "[1/3] 检查 Claude Code / Codex CLI 与 cloudflared..." -ForegroundColor Cyan`,
    `where.exe claude`,
    `where.exe codex`,
    `where.exe cloudflared`,
    ``,
    `# 2. 后台启动本地 Bridge 服务（监听 127.0.0.1:${port}）`,
    `Write-Host "[2/3] 启动 RelayDeck Bridge 服务 (端口 ${port})..." -ForegroundColor Cyan`,
    `Start-Process -NoNewWindow powershell -ArgumentList "-Command", "npm run build; npm run start"`,
    `Start-Sleep -Seconds 2`,
    ``,
    `# 3. 启动 Cloudflare Tunnel，映射到 https://${fullHostname}`,
    `Write-Host "[3/3] 正在连接 Cloudflare Tunnel (${tunnelName} -> https://${fullHostname})..." -ForegroundColor Green`,
    `cloudflared tunnel run ${tunnelName}`,
  ].join('\n');

  const dnsChecklist = [
    `等待 L53.NET 后台中 ${cleanRoot} 订单状态从「待配置」变为「已激活」。`,
    `登录 Cloudflare 控制台，点击「添加站点」，输入 ${cleanRoot} 并选择 Free 免费计划。`,
    `复制 Cloudflare 分配的两条 Nameserver（例如 xxx.ns.cloudflare.com），回到 L53.NET 修改该域名的 NS 记录并等待 5–15 分钟生效。`,
    `在 Windows PowerShell 运行 winget install Cloudflare.cloudflared 安装客户端，然后执行 cloudflared tunnel login 授权 ${cleanRoot}。`,
    `在 Cloudflare Zero Trust -> Networks -> Tunnels 创建隧道 ${tunnelName}，添加 Public Hostname：${fullHostname} 指向 http://127.0.0.1:${port}。`,
    `在 Zero Trust -> Access -> Applications 新建 Self-hosted 应用保护 ${fullHostname}，仅放行邮箱 ${config.allowedEmail.trim() || '你的常用邮箱'}（One-time PIN 登录）。`,
  ];

  return {
    fullHostname,
    envFile,
    cloudflaredYaml,
    powershellScript,
    dnsChecklist,
  };
}

export function formatRelativeTime(isoString: string, nowMs = Date.now()): string {
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return '刚刚';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 45) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 天前`;
}

export function parseUnifiedDiff(rawDiff: string): Array<{
  id: string;
  filePath: string;
  additions: number;
  deletions: number;
  hunks: string[];
}> {
  if (!rawDiff.trim()) return [];
  const blocks = rawDiff.split(/^diff --git /m).filter((b) => b.trim().length > 0);
  const results: Array<{
    id: string;
    filePath: string;
    additions: number;
    deletions: number;
    hunks: string[];
  }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split(/\r?\n/);
    const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+)$/);
    const filePath = headerMatch ? headerMatch[2].trim() : `changed-file-${i + 1}`;
    const hunkStart = lines.findIndex((l) => l.startsWith('@@'));
    if (hunkStart === -1) continue;

    const hunks = lines.slice(hunkStart).filter((l) => l !== '\\ No newline at end of file');
    let additions = 0;
    let deletions = 0;
    for (const line of hunks) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    results.push({
      id: `git-diff-${i}-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
      filePath,
      additions,
      deletions,
      hunks: hunks.slice(0, 120),
    });
  }

  return results;
}

