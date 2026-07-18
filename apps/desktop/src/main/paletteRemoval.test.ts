import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@apollo/shared';
import { shortcut, SHORTCUTS } from '@apollo/shared';

/**
 * K5 cleanup verification: the palette is provably absent. Grep gates fail the
 * build on any reference to the removed module, no palette window source
 * exists, no palette hotkey survives in settings or the shortcuts registry,
 * and the renderer build has no palette entry.
 */
const REPO = resolve(__dirname, '../../../..');
const SCAN_ROOTS = ['apps/desktop/src', 'packages/shared/src'];
// Identifiers of the removed module. Plain-English "color palette" usages
// (CALENDAR_PALETTE etc.) are intentionally NOT matched by these.
const FORBIDDEN = ['createPaletteWindow', 'getPaletteWindow', 'togglePalette', 'windows/palette', 'palettePlaceholder', 'tray.palette'];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'out' || name === 'dist') continue;
      yield* walk(p);
    } else if (/\.(ts|tsx|html|json)$/.test(name)) {
      yield p;
    }
  }
}

describe('K5 palette removal gates', () => {
  it('grep gate: no source file references the removed palette module', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO, root))) {
        if (file.endsWith('paletteRemoval.test.ts')) continue; // this gate itself
        const text = readFileSync(file, 'utf8');
        for (const needle of FORBIDDEN) {
          if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the palette window source directory is gone', () => {
    expect(existsSync(join(REPO, 'apps/desktop/src/renderer/windows/palette'))).toBe(false);
  });

  it('the renderer build config has no palette entry', () => {
    const cfg = readFileSync(join(REPO, 'apps/desktop/electron.vite.config.ts'), 'utf8');
    expect(cfg.includes('palette')).toBe(false);
  });

  it('no palette hotkey survives: settings has no top-level hotkey; PTT binding lives under voice', () => {
    const s = defaultSettings();
    expect('hotkey' in s).toBe(false);
    expect(s.voice.pttHotkey).toBe('Alt+Space');
  });

  it('the shortcuts registry has no palette entry and maps Mod+1 to Chat', () => {
    expect(shortcut('global.toggle')).toBeUndefined();
    expect(SHORTCUTS.some((sc) => /palette/i.test(sc.description))).toBe(false);
    expect(shortcut('workspace.chat')?.binding).toEqual({ key: '1', mod: true });
    // the help sheet renders from this same registry (single source, I6)
    expect(shortcut('global.ptt')?.description).toBe('Push to talk');
  });

  it('retained deliberately (K0): push-to-talk and Quick Capture are still present', () => {
    const s = defaultSettings();
    expect(s.ptt.enabled).toBe(true);
    expect(s.quickCapture.hotkey).toBe('CommandOrControl+Shift+N');
    expect(shortcut('global.capture')).toBeDefined();
  });
});
