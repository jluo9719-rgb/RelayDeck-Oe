import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  XCircle,
} from 'lucide-react';
import type { HostCapabilities, TunnelConfig } from '../types/bridge';
import {
  checkDomainCompatibility,
  generateSecureToken,
  generateTunnelArtifacts,
} from '../utils/bridgeLogic';
import { getStoredBridgeToken, setStoredBridgeToken } from '../utils/apiClient';
import { PWAInstallButton } from './PWAInstallButton';

interface TunnelSetupViewProps {
  config: TunnelConfig;
  hostCaps: HostCapabilities | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onSaveConfig: (patch: Partial<TunnelConfig>) => Promise<void>;
}

type ArtifactTab = 'steps' | 'ps1' | 'yaml' | 'env';

export const TunnelSetupView: React.FC<TunnelSetupViewProps> = ({
  config,
  hostCaps,
  darkMode,
  onToggleDarkMode,
  onSaveConfig,
}) => {
  const [form, setForm] = useState<TunnelConfig>(config);
  const [domainProbe, setDomainProbe] = useState(config.rootDomain);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactTab>('steps');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [clientToken, setClientToken] = useState(() => getStoredBridgeToken());
  const [tokenSaved, setTokenSaved] = useState(false);

  const probeResult = useMemo(() => checkDomainCompatibility(domainProbe), [domainProbe]);
  const artifacts = useMemo(() => generateTunnelArtifacts(form), [form]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-HTTPS clipboard environments
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleDownloadScript = () => {
    const blob = new Blob([artifacts.powershellScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'start-windows-bridge.ps1';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice('');
    try {
      await onSaveConfig(form);
      setSavedNotice('配置已保存到本地 Bridge 状态，脚本与环境变量已同步更新。');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClientToken = () => {
    setStoredBridgeToken(clientToken);
    setTokenSaved(true);
    window.setTimeout(() => setTokenSaved(false), 2000);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Windows + Cloudflare Tunnel 与 Access 接入配置
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            无需手机端安装 Tailscale，彻底避免与代理软件的 VPN 冲突。通过 Cloudflare 免费隧道与邮箱验证码保护，随时在手机浏览器或 PWA 控制电脑。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            {darkMode ? (
              <>
                <Sun className="h-4 w-4" aria-hidden="true" />
                <span>浅色外观</span>
              </>
            ) : (
              <>
                <Moon className="h-4 w-4" aria-hidden="true" />
                <span>深色外观</span>
              </>
            )}
          </button>
          <PWAInstallButton />
        </div>
      </div>

      {/* Domain Compatibility Comparison */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              域名可用性诊断（Cloudflare DNS 托管检测）
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Cloudflare Tunnel + Access 要求域名能将 NS 解析权托管至 Cloudflare。你可以直接点击下方两个域名查看差异：
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDomainProbe('yourname.ggff.net');
                  setForm((prev) => ({ ...prev, rootDomain: 'yourname.ggff.net' }));
                }}
                className="min-h-[38px] rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                检测 yourname.ggff.net (L53)
              </button>
              <button
                type="button"
                onClick={() => setDomainProbe('demo-host.duckdns.org')}
                className="min-h-[38px] rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                检测 demo-host.duckdns.org (DuckDNS)
              </button>
            </div>
          </div>

          <div className="w-full max-w-md">
            <label htmlFor="domain-probe-input" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              输入任意域名检测
            </label>
            <input
              id="domain-probe-input"
              type="text"
              value={domainProbe}
              onChange={(e) => setDomainProbe(e.target.value)}
              placeholder="example.com 或 yourname.ggff.net"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex items-start gap-3">
            {probeResult.compatible ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono">{probeResult.domain || '未输入'}</span>
                <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                <span
                  className={
                    probeResult.compatible
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }
                >
                  {probeResult.compatible ? '支持接入 Cloudflare Tunnel + Access' : '无法托管至 Cloudflare DNS'}
                </span>
                <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                <span className="font-normal text-slate-500 dark:text-slate-400">{probeResult.providerHint}</span>
              </p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">{probeResult.reason}</p>
              <p className="mt-1.5 font-medium text-slate-800 dark:text-slate-200">
                建议：{probeResult.recommendation}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Config Form + Live Generated Scripts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSave}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Windows 本地隧道参数
          </h2>

          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label htmlFor="cfg-sub" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                子域名前缀
              </label>
              <input
                id="cfg-sub"
                type="text"
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="col-span-3">
              <label htmlFor="cfg-root" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Cloudflare 主域名
              </label>
              <input
                id="cfg-root"
                type="text"
                value={form.rootDomain}
                onChange={(e) => setForm({ ...form, rootDomain: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
            手机端最终访问地址：https://{artifacts.fullHostname}
          </p>

          <div>
            <label htmlFor="cfg-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Cloudflare Access 放行邮箱（第一层身份校验）
            </label>
            <input
              id="cfg-email"
              type="email"
              value={form.allowedEmail}
              onChange={(e) => setForm({ ...form, allowedEmail: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="cfg-tunnel" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Tunnel 名称
              </label>
              <input
                id="cfg-tunnel"
                type="text"
                value={form.tunnelName}
                onChange={(e) => setForm({ ...form, tunnelName: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="cfg-port" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                本地端口
              </label>
              <input
                id="cfg-port"
                type="number"
                value={form.localPort}
                onChange={(e) => setForm({ ...form, localPort: Number(e.target.value) || 3000 })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="cfg-dir" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Windows 电脑上的 RelayDeck 部署目录
            </label>
            <input
              id="cfg-dir"
              type="text"
              value={form.windowsBridgeDir}
              onChange={(e) => setForm({ ...form, windowsBridgeDir: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="cfg-token" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Bridge 访问令牌（第二层 Bearer 校验）
              </label>
              <button
                type="button"
                onClick={() => setForm({ ...form, authToken: generateSecureToken(28) })}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                重新生成
              </button>
            </div>
            <input
              id="cfg-token"
              type="text"
              value={form.authToken}
              onChange={(e) => setForm({ ...form, authToken: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.keepAwake}
              onChange={(e) => setForm({ ...form, keepAwake: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
            />
            <span>在启动脚本中加入 Windows 防休眠指令（避免电脑睡眠断联）</span>
          </label>

          {savedNotice && (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{savedNotice}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] w-full rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {saving ? '保存中…' : '保存并刷新配置产物'}
          </button>
        </form>

        {/* Right: Generated Artifacts & Step-by-step Guide */}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
              {(
                [
                  { id: 'steps', label: '接入步骤' },
                  { id: 'ps1', label: 'start-bridge.ps1' },
                  { id: 'yaml', label: 'config.yml' },
                  { id: 'env', label: '.env' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveArtifact(tab.id)}
                  className={`min-h-[34px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeArtifact === tab.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeArtifact !== 'steps' && (
              <div className="flex items-center gap-2">
                {activeArtifact === 'ps1' && (
                  <button
                    type="button"
                    onClick={handleDownloadScript}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>下载脚本</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      activeArtifact,
                      activeArtifact === 'ps1'
                        ? artifacts.powershellScript
                        : activeArtifact === 'yaml'
                          ? artifacts.cloudflaredYaml
                          : artifacts.envFile
                    )
                  }
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  {copiedKey === activeArtifact ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>复制内容</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex-1">
            {activeArtifact === 'steps' ? (
              <ol className="space-y-3.5 text-sm text-slate-700 dark:text-slate-300">
                {artifacts.dnsChecklist.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="mt-0.5 font-mono text-xs font-semibold text-slate-400 tabular-nums dark:text-slate-500">
                      0{index + 1}.
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <pre className="max-h-[380px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {activeArtifact === 'ps1'
                  ? artifacts.powershellScript
                  : activeArtifact === 'yaml'
                    ? artifacts.cloudflaredYaml
                    : artifacts.envFile}
              </pre>
            )}
          </div>

          {/* Local host diagnostics + Mobile browser token pairing */}
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>当前宿主机检测结果</span>
              </div>
              <p className="mt-1.5 font-mono text-xs leading-6 text-slate-600 dark:text-slate-400">
                系统：{hostCaps?.platform ?? '检测中'} · 模式：{hostCaps?.execMode === 'live' ? '实机 CLI' : '交互预览'}
                <br />
                claude：{hostCaps?.binaries.claude ? '已就绪' : '未安装'} · codex：{hostCaps?.binaries.codex ? '已就绪' : '未安装'} · cloudflared：{hostCaps?.binaries.cloudflared ? '已就绪' : '未安装'}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>本机浏览器访问令牌（可选）</span>
              </div>
              <div className="mt-1.5 flex gap-2">
                <label htmlFor="client-bearer-token" className="sr-only">
                  本机浏览器 Bearer Token
                </label>
                <input
                  id="client-bearer-token"
                  type="password"
                  value={clientToken}
                  onChange={(e) => setClientToken(e.target.value)}
                  placeholder="启用 BRIDGE_AUTH_TOKEN 时填写"
                  className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleSaveClientToken}
                  className="min-h-[38px] shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {tokenSaved ? '已存' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
