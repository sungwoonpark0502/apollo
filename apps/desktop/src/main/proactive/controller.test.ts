import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { defaultSettings, type Settings, type SuggestionDTO } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createProactiveController } from './controller';
import { createFakeClock } from './fakeClock';
import { type ProactiveRule } from './types';

const TZ = 'America/Los_Angeles';
let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function tsRule(id: string, key: string): ProactiveRule {
  return {
    id, name: `${id} nudges`, description: '', defaultEnabled: true, defaultParams: {}, triggers: ['boot'],
    evaluate: async (ctx) => [{
      ruleId: id, urgency: 'time-sensitive', title: `${id}!`, body: 'now',
      actions: [
        { id: 'snooze', label: 'Snooze', kind: 'snooze' },
        { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
      ],
      dedupeKey: key, expiresAt: ctx.now + 3_600_000,
    }],
  };
}

function setup(opts: { rules: ProactiveRule[]; startIso: string; settings?: Settings } ) {
  const clock = createFakeClock(DateTime.fromISO(opts.startIso, { zone: TZ }).toMillis());
  let settings = opts.settings ?? defaultSettings();
  const pushed: Array<{ suggestion?: SuggestionDTO; group?: SuggestionDTO[]; silent: boolean }> = [];
  const notified: Array<{ title: string; body: string }> = [];
  const navigated: unknown[] = [];
  const controller = createProactiveController({
    repos,
    settings: () => settings,
    saveSettings: (n) => { settings = n; },
    tz: () => TZ,
    gmailConnected: () => false,
    voiceBusy: () => false,
    isFullscreen: () => false,
    push: (p) => pushed.push(p),
    notify: (title, body) => notified.push({ title, body }),
    navigate: (t) => navigated.push(t),
    isDND: () => false,
    rules: opts.rules,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  return { controller, clock, pushed, notified, navigated, getSettings: () => settings };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('proactive controller delivery (6.3)', () => {
  it('delivers a single nudge as suggestion and tracks it live', async () => {
    const { controller, pushed } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.suggestion?.ruleId).toBe('meeting_lead');
    expect(controller._live.size).toBe(1);
    controller.stop();
  });

  it('fires an OS notification only for meeting_lead', async () => {
    const { controller, notified } = setup({ rules: [tsRule('meeting_lead', 'a'), tsRule('overdue_todos', 'b')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    expect(notified).toHaveLength(1);
    expect(notified[0]!.title).toContain('meeting_lead');
    controller.stop();
  });

  it('dismiss records the outcome and clears the live entry', async () => {
    const { controller, pushed } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    const id = pushed[0]!.suggestion!.id;
    controller.handleAction(id, 'dismiss');
    expect(repos.suggestions.get(id)?.outcome).toBe('dismissed');
    expect(controller._live.size).toBe(0);
    controller.stop();
  });

  it('auto-dismiss after 20s records expired', async () => {
    const { controller, clock, pushed } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    const id = pushed[0]!.suggestion!.id;
    clock.advance(20_000);
    expect(repos.suggestions.get(id)?.outcome).toBe('expired');
    controller.stop();
  });

  it('snooze re-delivers after 5 minutes', async () => {
    const { controller, clock, pushed } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    const id = pushed[0]!.suggestion!.id;
    controller.handleAction(id, 'snooze');
    expect(repos.suggestions.get(id)?.outcome).toBe('snoozed');
    clock.advance(5 * 60_000);
    await flush();
    expect(pushed).toHaveLength(2);
    controller.stop();
  });

  it('a primary "open" action deep-links and records acted', async () => {
    const rule: ProactiveRule = {
      id: 'overdue_todos', name: 'overdue', description: '', defaultEnabled: true, defaultParams: {}, triggers: ['boot'],
      evaluate: async (ctx) => [{
        ruleId: 'overdue_todos', urgency: 'low', title: 'overdue', body: '',
        actions: [{ id: 'open', label: 'Open today', kind: 'primary' }, { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
        dedupeKey: 'k', expiresAt: ctx.now + 3_600_000,
      }],
    };
    const { controller, pushed, navigated } = setup({ rules: [rule], startIso: '2026-07-13T17:00:00' });
    controller.start();
    await flush();
    const id = pushed[0]!.suggestion!.id;
    controller.handleAction(id, 'open');
    expect(repos.suggestions.get(id)?.outcome).toBe('acted');
    expect(navigated).toEqual([{ view: 'today' }]);
    controller.stop();
  });

  it('the auto-tune "disable" action turns the rule off in settings', async () => {
    const { controller, getSettings } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00' });
    controller.start();
    await flush();
    controller.setRuleEnabled('meeting_lead', false);
    expect(getSettings().proactive.rules['meeting_lead']?.enabled).toBe(false);
    controller.stop();
  });

  it('status reports enabled rule names and remaining budget', async () => {
    const { controller } = setup({ rules: [tsRule('meeting_lead', 'k')], startIso: '2026-07-13T12:00:00', settings: withMax(2) });
    controller.start();
    await flush();
    const st = controller.status();
    expect(st.enabledRules).toContain('meeting_lead nudges');
    // time-sensitive delivery does not consume the low/normal budget
    expect(st.remainingBudget).toBe(2);
    controller.stop();
  });
});

function withMax(n: number): Settings {
  const s = defaultSettings();
  s.proactive.maxPerDay = n;
  return s;
}

