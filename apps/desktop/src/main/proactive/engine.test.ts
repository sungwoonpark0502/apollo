import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { defaultSettings, type Settings, type SuggestionDTO } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createEngine } from './engine';
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

function setup(opts: { rules: ProactiveRule[]; startIso: string; settings?: Settings; voiceBusy?: () => boolean; fullscreen?: () => boolean }) {
  const clock = createFakeClock(DateTime.fromISO(opts.startIso, { zone: TZ }).toMillis());
  const delivered: Array<{ group: SuggestionDTO[]; silent: boolean }> = [];
  const settings = opts.settings ?? defaultSettings();
  const engine = createEngine({
    repos,
    settings: () => settings,
    tz: () => TZ,
    gmailConnected: () => false,
    voiceBusy: opts.voiceBusy ?? (() => false),
    isFullscreen: opts.fullscreen ?? (() => false),
    deliver: (group, o) => delivered.push({ group, silent: o.silent }),
    now: clock.now,
    setTimer: clock.setTimer,
    rules: opts.rules,
  });
  return { engine, clock, delivered, settings };
}

/** A rule that emits one time-sensitive candidate at a fixed time. */
function fixedRule(id: string, dedupeKey: string, expiresInMs = 3_600_000): ProactiveRule {
  return {
    id, name: `${id} nudges`, description: '', defaultEnabled: true, defaultParams: {},
    triggers: ['tick', 'boot'],
    evaluate: async (ctx) => [{
      ruleId: id, urgency: 'time-sensitive', title: `${id} fires`, body: '',
      actions: [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
      dedupeKey, expiresAt: ctx.now + expiresInMs,
    }],
  };
}

describe('engine (F3)', () => {
  it('a throwing rule is isolated and never crashes the engine', async () => {
    const bad: ProactiveRule = {
      id: 'bad', name: 'bad', description: '', defaultEnabled: true, defaultParams: {}, triggers: ['boot'],
      evaluate: async () => { throw new Error('boom'); },
    };
    const good = fixedRule('good', 'g1');
    const { engine, delivered } = setup({ rules: [bad, good], startIso: '2026-07-13T12:00:00' });
    engine.start();
    await tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.group[0]!.ruleId).toBe('good');
    engine.stop();
  });

  it('busy-deferred candidate delivers after the 30s defer elapses (fake clock)', async () => {
    let busy = true;
    const { engine, clock, delivered } = setup({ rules: [fixedRule('r', 'k')], startIso: '2026-07-13T12:00:00', voiceBusy: () => busy });
    engine.start();
    await tick();
    expect(delivered).toHaveLength(0); // deferred while busy
    busy = false;
    clock.advance(30_000);
    await tick();
    expect(delivered).toHaveLength(1);
    engine.stop();
  });

  it('dedupe holds across a re-run of the same trigger', async () => {
    const { engine, delivered } = setup({ rules: [fixedRule('r', 'once')], startIso: '2026-07-13T12:00:00' });
    engine.start();
    await tick();
    await engine._runTrigger('tick');
    await tick();
    expect(delivered).toHaveLength(1); // second evaluation deduped
    engine.stop();
  });

  it('snooze re-enters with a suffixed dedupe key after the snooze elapses', async () => {
    const { engine, clock, delivered } = setup({ rules: [fixedRule('r', 'meet', 3_600_000)], startIso: '2026-07-13T12:00:00' });
    engine.start();
    await tick();
    expect(delivered).toHaveLength(1);
    const shownId = delivered[0]!.group[0]!.id;
    engine.snooze(shownId, 5);
    clock.advance(5 * 60_000);
    await tick();
    expect(delivered).toHaveLength(2); // re-entered as a fresh suggestion
    expect(repos.suggestions.get(shownId)?.outcome).toBe('snoozed');
    engine.stop();
  });

  it('recordOutcome persists the outcome', async () => {
    const { engine, delivered } = setup({ rules: [fixedRule('r', 'k')], startIso: '2026-07-13T12:00:00' });
    engine.start();
    await tick();
    const id = delivered[0]!.group[0]!.id;
    engine.recordOutcome(id, 'acted');
    expect(repos.suggestions.get(id)?.outcome).toBe('acted');
    engine.stop();
  });

  it('respects the master proactive switch', async () => {
    const settings = defaultSettings();
    settings.proactive.enabled = false;
    const { engine, delivered } = setup({ rules: [fixedRule('r', 'k')], startIso: '2026-07-13T12:00:00', settings });
    engine.start();
    await tick();
    expect(delivered).toHaveLength(0);
    engine.stop();
  });
});

// let queued microtasks (async evaluate) settle
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
