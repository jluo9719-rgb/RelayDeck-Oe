import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  STARFIELD_STORAGE_KEY,
  isDarkTheme,
  isValidThemeId,
  loadThemePreferences,
  resolveThemePreset,
  saveThemePreferences,
} from './themeConfig';

test('defaults to anime dark theme with starfield enabled', () => {
  assert.equal(DEFAULT_THEME_ID, 'anime');
  assert.equal(isDarkTheme('anime'), true);
  assert.equal(isDarkTheme('light'), false);
  assert.equal(THEME_PRESETS.length, 4);
});

test('resolves unknown theme IDs safely back to default', () => {
  assert.equal(isValidThemeId('cyber'), true);
  assert.equal(isValidThemeId('unknown-theme'), false);
  assert.equal(resolveThemePreset('invalid').id, DEFAULT_THEME_ID);
  assert.equal(resolveThemePreset('obsidian').name, '液态曜石');
});

test('loads and saves preferences via storage interface', () => {
  const map = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };

  const initial = loadThemePreferences(mockStorage);
  assert.deepEqual(initial, { themeId: 'anime', starfieldEnabled: true });

  saveThemePreferences({ themeId: 'cyber', starfieldEnabled: false }, mockStorage);
  assert.equal(map.get(THEME_STORAGE_KEY), 'cyber');
  assert.equal(map.get(STARFIELD_STORAGE_KEY), 'false');
  assert.deepEqual(loadThemePreferences(mockStorage), {
    themeId: 'cyber',
    starfieldEnabled: false,
  });
});
