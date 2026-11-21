import React, { useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        <span>{compact ? '安装应用' : '安装到手机主屏幕 (PWA)'}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        <span>{isIOS ? 'iOS 添加到主屏幕' : compact ? '安装指南' : '手机主屏幕安装说明'}</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="pwa-guide-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  将 RelayDeck 添加到手机主屏幕
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  无需应用商店，像原生 App 一样全屏快速启动，且不会与代理软件产生 VPN 冲突。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭安装说明"
                onClick={() => setShowGuide(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm text-slate-700 dark:text-slate-300">
              <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
                <p className="font-semibold text-slate-900 dark:text-slate-100">iPhone / iPad (Safari)</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-slate-600 dark:text-slate-400">
                  <li>用 Safari 打开你的隧道域名（如 <span className="font-mono">https://agent.example.com</span>）。</li>
                  <li>点击底部工具栏的「分享」图标。</li>
                  <li>向下滑动并选择「添加到主屏幕」，确认名称为 RelayDeck。</li>
                </ol>
              </div>

              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">Android (Chrome / Edge)</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-slate-600 dark:text-slate-400">
                  <li>在浏览器打开控制台地址后，点击右上角菜单按钮。</li>
                  <li>选择「安装应用」或「添加到主屏幕」。</li>
                </ol>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
