import { describe, expect, it } from 'vitest';
import { settingsTabsFor, STRINGS } from '@apollo/shared';
import { searchSettings, SETTINGS_INDEX, type TabId } from './settingsIndex';

/**
 * Settings search has to find the setting, not just the page it lives on. These
 * pin that behavior with the words a person would actually type, which is the
 * part that silently rots as copy changes.
 */
describe('settings search', () => {
  it('finds a setting by its own label, not just its section', () => {
    const ids = searchSettings('quiet').map((r) => r.id);
    expect(ids).toContain('quietHours');
  });

  it('finds settings by what a person would call them', () => {
    const cases: Array<[string, string]> = [
      ['do not disturb', 'quietHours'],
      ['dnd', 'quietHours'],
      ['log out', 'signOut'],
      ['logout', 'signOut'],
      ['password', 'signIn'],
      ['volume', 'earconVolume'],
      ['sound', 'earconVolume'],
      ['hey apollo', 'wake'],
      ['pomodoro', 'breaks'],
      ['delete everything', 'wipe'],
      ['backup', 'export'],
      ['google', 'connectors'],
      ['shortcut', 'quickCaptureHotkey'],
      ['startup', 'launchAtLogin'],
    ];
    for (const [query, expected] of cases) {
      expect(searchSettings(query).map((r) => r.id), `query: ${query}`).toContain(expected);
    }
  });

  it('is case-insensitive and tolerates surrounding spaces', () => {
    expect(searchSettings('  QUIET  ').map((r) => r.id)).toContain('quietHours');
  });

  it('ranks an exact label above a keyword match', () => {
    // "Break reminders" as a label must beat anything that merely mentions it.
    const first = searchSettings(STRINGS.settings.timeFocus.breaks)[0];
    expect(first?.id).toBe('breaks');
  });

  it('ranks a label prefix above a mid-word hit', () => {
    const results = searchSettings('quiet');
    const quietIdx = results.findIndex((r) => r.id === 'quietHours');
    expect(quietIdx).toBe(0);
  });

  it('returns nothing for an empty query rather than the whole list', () => {
    // An empty box must show the tab list, not every setting at once.
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchSettings('xyzzy-not-a-setting')).toEqual([]);
  });

  it('also matches by section name, so searching a tab still works', () => {
    expect(searchSettings('privacy').length).toBeGreaterThan(0);
  });
});

describe('settings index integrity', () => {
  it('every entry points at a tab that exists in some mode', () => {
    const known = new Set<TabId>([...settingsTabsFor('managed'), ...settingsTabsFor('byok')] as TabId[]);
    const orphans = SETTINGS_INDEX.filter((e) => !known.has(e.tab));
    expect(orphans.map((e) => `${e.id} → ${e.tab}`)).toEqual([]);
  });

  it('every tab in the managed UI has at least one searchable setting', () => {
    // A section with nothing indexed is a section search can never reach.
    const covered = new Set(SETTINGS_INDEX.map((e) => e.tab));
    const missing = (settingsTabsFor('managed') as TabId[]).filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });

  it('ids are unique', () => {
    const ids = SETTINGS_INDEX.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no entry has an empty label', () => {
    expect(SETTINGS_INDEX.filter((e) => e.label.trim().length === 0)).toEqual([]);
  });
});

describe('settings tab list', () => {
  it('managed shows Account; BYOK has no account to manage', () => {
    expect(settingsTabsFor('managed')).toContain('account');
    expect(settingsTabsFor('byok')).not.toContain('account');
  });

  it('the credentials screen is hidden in BOTH modes by default', () => {
    // Credentials come from the environment. A tab full of vendor names and
    // "API key" fields is plumbing, and no user should meet it.
    expect(settingsTabsFor('managed')).not.toContain('keys');
    expect(settingsTabsFor('byok')).not.toContain('keys');
  });

  it('APOLLO_SHOW_KEYS reveals it for the rare paste-a-key case', () => {
    expect(settingsTabsFor('byok', { showKeys: true })).toContain('keys');
    expect(settingsTabsFor('managed', { showKeys: true })).toContain('keys');
  });

  it('leads with General and keeps the requested core sections', () => {
    const managed = settingsTabsFor('managed');
    expect(managed[0]).toBe('general');
    for (const required of ['general', 'account', 'privacy', 'capabilities', 'timeFocus', 'customize']) {
      expect(managed).toContain(required);
    }
  });

  it('has no top-level Diagnostics: it lives inside About (L5)', () => {
    expect(settingsTabsFor('managed')).not.toContain('diagnostics');
  });

  it('every listed tab has a display name', () => {
    for (const t of [...settingsTabsFor('managed'), ...settingsTabsFor('byok')]) {
      expect(STRINGS.settings.tabs[t as TabId]).toBeTruthy();
    }
  });
});
