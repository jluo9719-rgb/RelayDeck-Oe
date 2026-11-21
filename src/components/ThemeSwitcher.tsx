import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette, Sparkles } from 'lucide-react';
import {
  THEME_PRESETS,
  isDarkTheme,
  resolveThemePreset,
  type ThemeId,
} from '../utils/themeConfig';

interface ThemeSwitcherProps {
  themeId: ThemeId;
  starfieldEnabled: boolean;
  onSelectTheme: (id: ThemeId) => void;
  onToggleStarfield: () => void;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  themeId,
  starfieldEnabled,
  onSelectTheme,
  onToggleStarfield,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const current = resolveThemePreset(themeId);
  const isDark = isDarkTheme(themeId);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`切换皮肤，当前：${current.name}`}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:px-3 dark:border-violet-400/25 dark:bg-slate-900/80 dark:text-violet-200 dark:hover:bg-slate-800/90 whitespace-nowrap"
      >
        <Palette className="h-4 w-4 text-violet-600 dark:text-purple-400" aria-hidden="true" />
        <span className="hidden sm:inline">{current.name}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="外观与粒子设置"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[276px] rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xl dark:border-violet-400/25 dark:bg-[#0d1222]/95 dark:backdrop-blur-xl"
        >
          <div className="flex items-center justify-between pb-2.5">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              皮肤主题
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              实时生效
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESETS.map((preset) => {
              const selected = preset.id === themeId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectTheme(preset.id)}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border p-2 text-left transition-all ${
                    selected
                      ? 'border-violet-500 ring-1 ring-violet-500/60 dark:border-purple-400 dark:ring-purple-400/50'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-violet-400/40'
                  }`}
                >
                  <div
                    className="relative mb-2 h-12 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
                    style={{ background: preset.previewBg }}
                  >
                    {preset.wallpaperUrl && (
                      <img
                        src={preset.wallpaperUrl}
                        alt={preset.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover object-top opacity-80"
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: preset.previewAccent }}
                    />
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white">
                        <Check className="h-2.5 w-2.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {preset.name}
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-[10px] text-slate-500 dark:text-slate-400">
                    {preset.subtitle}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800/90">
            <button
              type="button"
              disabled={!isDark}
              onClick={onToggleStarfield}
              className="flex min-h-[40px] w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-left transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-400/20 dark:bg-slate-900/75 dark:hover:bg-slate-800/80"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-100">
                <Sparkles className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" aria-hidden="true" />
                <span>星空与流星粒子</span>
              </span>
              <span
                className={`text-xs font-semibold ${
                  isDark && starfieldEnabled
                    ? 'text-violet-600 dark:text-purple-300'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {!isDark ? '仅暗色' : starfieldEnabled ? '已开启' : '已关闭'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
