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

  it('the shortcuts registry has no palette entry and maps Mod+1 to Today (L2)', () => {
    expect(shortcut('global.toggle')).toBeUndefined();
    expect(SHORTCUTS.some((sc) => /palette/i.test(sc.description))).toBe(false);
    expect(shortcut('workspace.today')?.binding).toEqual({ key: '1', mod: true });
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

describe('L5 settings surface (12.3)', () => {
  it('the Workspace no longer references the removed keys-banner strings', () => {
    const src = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/workspace/WorkspaceApp.tsx'), 'utf8');
    expect(src).not.toContain('keysSkippedBanner');
    expect(src).not.toContain('keysSkippedAction');
    expect(src).toContain('assistantReadiness'); // readiness is computed at the source
  });

  it('Settings renders its tab list from the shared mode-aware helper', () => {
    const src = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/settings/SettingsApp.tsx'), 'utf8');
    expect(src).toContain('settingsTabsFor');
    expect(src).not.toMatch(/TAB_ORDER\s*[:=]/); // no hand-maintained duplicate list
  });

  it('the calendars UI has no color picker (L5 removes user-chosen colors)', () => {
    const src = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/settings/CalendarsTab.tsx'), 'utf8');
    expect(src).not.toContain('ColorSwatch');
    expect(src).not.toContain('CALENDAR_PALETTE');
    expect(src).toContain('SourceDot');
  });

  it('Diagnostics is rendered inside About, not as a top-level tab', () => {
    const about = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/settings/AboutTab.tsx'), 'utf8');
    expect(about).toContain('DiagnosticsTab');
    const settings = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/settings/SettingsApp.tsx'), 'utf8');
    expect(settings).not.toContain('DiagnosticsTab');
  });
});

describe('L2 rail, Today, and To-dos removal (12.4)', () => {
  it('the rail lists Today first, then Chat, Calendar, Notes', () => {
    const src = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/workspace/WorkspaceApp.tsx'), 'utf8');
    // The Settings button is written multi-line, so allow any whitespace.
    const order = [...src.matchAll(/<RailButton\s+label=\{STRINGS\.workspace\.nav\.(\w+)\}/g)].map((m) => m[1]);
    expect(order).toEqual(['today', 'chat', 'calendar', 'notes', 'settings']);
  });

  it('Today renders exactly the header plus schedule, weather, and news', () => {
    const src = readFileSync(join(REPO, 'apps/desktop/src/renderer/windows/workspace/TodayView.tsx'), 'utf8');
    const sections = [...src.matchAll(/<Section\s+title=\{STRINGS\.workspace\.today\.(\w+)\}/g)].map((m) => m[1]);
    expect(sections).toEqual(['todaysEvents', 'weather', 'weather', 'news']); // weather has empty + populated branches
    // The removed sections are gone.
    for (const gone of ['upNext', 'reminders', 'todos', 'latestBrief']) {
      expect(src).not.toContain(`today.${gone}`);
    }
    expect(src).not.toContain('todos.');
  });

  it('no todo tool, IPC channel, or proactive rule survives', () => {
    expect(existsSync(join(REPO, 'apps/desktop/src/main/tools/todo.ts'))).toBe(false);
    expect(existsSync(join(REPO, 'apps/desktop/src/main/proactive/rules/overdueTodos.ts'))).toBe(false);
    const ipc = readFileSync(join(REPO, 'packages/shared/src/ipc.ts'), 'utf8');
    expect(ipc).not.toMatch(/'todos\.(list|add|toggle|delete)'/);
    const rules = readFileSync(join(REPO, 'apps/desktop/src/main/proactive/rules/index.ts'), 'utf8');
    expect(rules).not.toMatch(/import .*overdueTodos/); // not imported
    expect(rules).not.toMatch(/BUILTIN_RULES[^;]*overdueTodos/s); // not registered
  });

  it('the eval set no longer exercises todo tools', () => {
    const golden = readFileSync(join(REPO, 'eval/golden.jsonl'), 'utf8');
    expect(golden).not.toContain('"todo.');
  });
});


describe('source hygiene (CI gate protection)', () => {
  it('no source file contains a NUL byte', () => {
    // A stray NUL makes grep report "Binary file X matches" and exit 0, which
    // silently flips the negated security grep-gates into a failure that says
    // nothing about the property being checked. Keep sources plain text and
    // write control characters as escapes instead of embedding them.
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO, root))) {
        if (readFileSync(file).includes(0)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source file is checked out with CRLF line endings', () => {
    // .gitattributes pins LF; a CRLF checkout diffs the schema snapshot.
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO, root))) {
        if (readFileSync(file, 'utf8').includes('\r\n')) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
