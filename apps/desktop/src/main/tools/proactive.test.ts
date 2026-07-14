import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type Settings, type ToolCtx } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createProactiveTools } from './proactive';

let db: Db;
let repos: Repos;
let settings: Settings;

const ctx = { turnId: 't1', convId: 'c1' } as ToolCtx;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  settings = defaultSettings();
});

function tools() {
  return createProactiveTools({
    getSettings: () => settings,
    setSettings: (n) => { settings = n; },
    status: () => ({ enabledRules: ['meeting reminders'], remainingBudget: 4 }),
    undo: repos.undo,
  });
}

describe('proactive.configure (F3.4)', () => {
  it('disables a single rule and names it', async () => {
    const [configure] = tools();
    const res = await configure!.execute({ ruleId: 'meeting_lead', enabled: false }, ctx);
    expect(settings.proactive.rules['meeting_lead']?.enabled).toBe(false);
    expect(res.llmText.toLowerCase()).toContain('meeting');
    expect(res.undoToken).toBeTruthy();
  });

  it('"all" toggles the master switch', async () => {
    const [configure] = tools();
    await configure!.execute({ ruleId: 'all', enabled: false }, ctx);
    expect(settings.proactive.enabled).toBe(false);
    await configure!.execute({ ruleId: 'all', enabled: true }, ctx);
    expect(settings.proactive.enabled).toBe(true);
  });

  it('is undoable — undo restores the prior state', async () => {
    const [configure] = tools();
    expect(settings.proactive.enabled).toBe(true);
    await configure!.execute({ ruleId: 'all', enabled: false }, ctx);
    expect(settings.proactive.enabled).toBe(false);
    // pop + apply the inverse (as undo.last does)
    const entry = repos.undo.popLatest('c1')!;
    const { applyUndoEntry } = await import('./undo');
    applyUndoEntry(repos, { tool: entry.tool, data: entry.data });
    expect(settings.proactive.enabled).toBe(true);
  });

  it('rejects an unknown rule id via zod', () => {
    const [configure] = tools();
    expect(configure!.params.safeParse({ ruleId: 'nonsense', enabled: false }).success).toBe(false);
    expect(configure!.params.safeParse({ ruleId: 'meeting_lead', enabled: true }).success).toBe(true);
    expect(configure!.params.safeParse({ ruleId: 'all', enabled: true }).success).toBe(true);
  });
});

describe('proactive.status', () => {
  it('reports enabled rules and remaining budget', async () => {
    const [, status] = tools();
    const res = await status!.execute({}, ctx);
    expect(res.llmText).toContain('meeting reminders');
    expect(res.llmText).toContain('4');
  });

  it('is tier 1 (read-only, no confirmation)', () => {
    const [configure, status] = tools();
    expect(status!.tier).toBe(1);
    expect(configure!.tier).toBe(2);
  });
});
