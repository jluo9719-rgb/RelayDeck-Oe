export type ThemeId = 'anime' | 'cyber' | 'obsidian' | 'light';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  subtitle: string;
  isDark: boolean;
  previewBg: string;
  previewAccent: string;
  wallpaperUrl?: string;
}

export interface ThemePreferences {
  themeId: ThemeId;
  starfieldEnabled: boolean;
}

export const ANIME_WALLPAPER_URL = '/src/assets/images/anime_night_wallpaper_1795247004951.jpg';

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'anime',
    name: '暗夜幻影',
    subtitle: '暗黑动漫背景 · 磨砂通透',
    isDark: true,
    previewBg: 'linear-gradient(135deg, #060810 0%, #171226 55%, #071916 100%)',
    previewAccent: '#c084fc',
    wallpaperUrl: ANIME_WALLPAPER_URL,
  },
  {
    id: 'cyber',
    name: '极夜霓虹',
    subtitle: '深空点阵网格 · 引擎微光',
    isDark: true,
    previewBg: 'linear-gradient(135deg, #060914 0%, #1b1033 55%, #0c1f2e 100%)',
    previewAccent: '#38bdf8',
  },
  {
    id: 'obsidian',
    name: '液态曜石',
    subtitle: '静谧曜石渐变 · 旗舰玻璃',
    isDark: true,
    previewBg: 'linear-gradient(135deg, #0b1120 0%, #1e1b4b 60%, #0f172a 100%)',
    previewAccent: '#a78bfa',
  },
  {
    id: 'light',
    name: '晨雾浅色',
    subtitle: '白天户外高对比浅色',
    isDark: false,
    previewBg: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
    previewAccent: '#7c3aed',
  },
] as const;

export const DEFAULT_THEME_ID: ThemeId = 'anime';
export const THEME_STORAGE_KEY = 'relaydeck_theme_v2';
export const STARFIELD_STORAGE_KEY = 'relaydeck_starfield';

export function isValidThemeId(value: unknown): value is ThemeId {
  return value === 'anime' || value === 'cyber' || value === 'obsidian' || value === 'light';
}

export function resolveThemePreset(id: unknown): ThemePreset {
  const safeId: ThemeId = isValidThemeId(id) ? id : DEFAULT_THEME_ID;
  return THEME_PRESETS.find((preset) => preset.id === safeId) ?? THEME_PRESETS[0];
}

export function isDarkTheme(id: ThemeId): boolean {
  return resolveThemePreset(id).isDark;
}

export function loadThemePreferences(storage?: Pick<Storage, 'getItem'> | null): ThemePreferences {
  if (!storage) {
    return { themeId: DEFAULT_THEME_ID, starfieldEnabled: true };
  }
  try {
    const rawTheme = storage.getItem(THEME_STORAGE_KEY);
    const themeId: ThemeId = isValidThemeId(rawTheme) ? rawTheme : DEFAULT_THEME_ID;
    const rawStarfield = storage.getItem(STARFIELD_STORAGE_KEY);
    const starfieldEnabled = rawStarfield === null ? true : rawStarfield !== 'false';
    return { themeId, starfieldEnabled };
  } catch {
    return { themeId: DEFAULT_THEME_ID, starfieldEnabled: true };
  }
}

export function saveThemePreferences(
  prefs: ThemePreferences,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, prefs.themeId);
    storage.setItem(STARFIELD_STORAGE_KEY, prefs.starfieldEnabled ? 'true' : 'false');
    storage.setItem('relaydeck_theme', isDarkTheme(prefs.themeId) ? 'dark' : 'light');
  } catch {
    // Ignore storage quota or private browsing errors
  }
}
