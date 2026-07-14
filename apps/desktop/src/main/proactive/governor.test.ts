import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { defaultSettings, type Settings, type SuggestionDTO } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createSuggestionsRepo, type SuggestionsRepo } from '../db/repos/suggestions';
import { createGovernor, type Governor } from './governor';
import { type CandidateSuggestion } from './types';

const TZ = 'America/Los_Angeles';
// Monday 2026-07-13 12:00 PT — outside the default DND window (22–8).
const NOON = DateTime.fromISO('2026-07-13T12:00:00', { zone: TZ }).toMillis();

interface Harness {
  gov: Governor;
  repo: SuggestionsRepo;
  delivered: Array<{ group: SuggestionDTO[]; silent: boolean }>;
  clock: { now: number };
  settings: Settings;
  voiceBusy: boolean;
  fullscreen: boolean;
}

let db: Db;

function candidate(over: Partial<CandidateSuggestion> = {}): CandidateSuggestion {
  return {
    ruleId: 'overdue_todos',
    urgency: 'normal',
    title: 'A nudge',
    body: 'body',
    actions: [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
    dedupeKey: `k-${Math.random()}`,
    expiresAt: NOON + 6 * 3_600_000,
    ...over,
  };
}

function harness(over: Partial<Harness> = {}): Harness {
  const repo = createSuggestionsRepo(db, { tz: () => TZ });
  const h: Harness = {
    repo,
    delivered: [],
    clock: { now: NOON },
    settings: defaultSettings(),
    voiceBusy: false,
    fullscreen: false,
    gov: null as unknown as Governor,
    ...over,
  };
  h.gov = createGovernor({
    now: () => h.clock.now,
    tz: () => TZ,
    repo,
    settings: () => h.settings,
    voiceBusy: () => h.voiceBusy,
    isFullscreen: () => h.fullscreen,
    deliver: (group, opts) => h.delivered.push({ group, silent: opts.silent }),
    ruleDisplayName: (id) => `${id} nudges`,
  });
  return h;
}

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});

describe('governor — dedupe (F3.2 step 2)', () => {
  it('drops a candidate whose (ruleId, dedupeKey) already exists, regardless of outcome', () => {
    const h = harness();
    h.gov.process([candidate({ dedupeKey: 'x' })]);
    expect(h.delivered).toHaveLength(1);
    // second identical candidate is deduped even after we mark it dismissed
    const shown = h.repo.recent(1)[0]!;
    h.repo.recordOutcome(shown.id, 'dismissed');
    h.gov.process([candidate({ dedupeKey: 'x' })]);
    expect(h.delivered).toHaveLength(1); // no new delivery
  });

  it('dedupe survives a fresh repo over the same db (restart)', () => {
    const h = harness();
    h.gov.process([candidate({ dedupeKey: 'persist' })]);
    const h2 = harness();
    h2.gov.process([candidate({ dedupeKey: 'persist' })]);
    expect(h2.delivered).toHaveLength(0);
  });
});

describe('governor — expiry (step 3)', () => {
  it('drops candidates past expiresAt', () => {
    const h = harness();
    h.gov.process([candidate({ expiresAt: NOON - 1 })]);
    expect(h.delivered).toHaveLength(0);
  });
});

describe('governor — DND (step 4)', () => {
  it('time-sensitive delivers silently during DND; low/normal defer to after DND', () => {
    const midnight = DateTime.fromISO('2026-07-13T00:30:00', { zone: TZ }).toMillis(); // within 22–8
    const h = harness({ clock: { now: midnight } });
    const res = h.gov.process([
      candidate({ urgency: 'time-sensitive', dedupeKey: 'ts', expiresAt: midnight + 3_600_000 }),
      candidate({ urgency: 'normal', dedupeKey: 'lo', expiresAt: midnight + 12 * 3_600_000 }),
    ]);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.silent).toBe(true);
    expect(h.delivered[0]!.group[0]!.urgency).toBe('time-sensitive');
    // the normal one is deferred to just after DND ends (08:00 + 1 min)
    const deferred = res.deferrals.find((d) => d.candidate.dedupeKey === 'lo');
    expect(deferred).toBeDefined();
    const endHour = DateTime.fromMillis(deferred!.atMs, { zone: TZ });
    expect(endHour.hour).toBe(8);
    expect(endHour.minute).toBe(1);
  });
});

describe('governor — budget (step 5)', () => {
  it('defers low/normal once maxPerDay reached; time-sensitive is exempt', () => {
    const h = harness();
    h.settings.proactive.maxPerDay = 2;
    h.gov.process([candidate({ dedupeKey: 'a' })]);
    h.clock.now = NOON + 21 * 60_000; // clear the 20-min spacing window
    h.gov.process([candidate({ dedupeKey: 'b' })]);
    expect(h.delivered).toHaveLength(2);
    // third normal is over budget → deferred to tomorrow (expires far enough out to survive)
    const res = h.gov.process([candidate({ dedupeKey: 'c', expiresAt: NOON + 2 * 86_400_000 })]);
    expect(h.delivered).toHaveLength(2);
    expect(res.deferrals[0]!.candidate.dedupeKey).toBe('c');
    expect(DateTime.fromMillis(res.deferrals[0]!.atMs, { zone: TZ }).toISODate()).toBe('2026-07-14'); // tomorrow
    // a time-sensitive still delivers despite the exhausted budget (spacing-exempt too)
    h.gov.process([candidate({ urgency: 'time-sensitive', dedupeKey: 'ts' })]);
    expect(h.delivered).toHaveLength(3);
  });

  it('drops an over-budget candidate that expires before tomorrow', () => {
    const h = harness();
    h.settings.proactive.maxPerDay = 0;
    const res = h.gov.process([candidate({ dedupeKey: 'x', expiresAt: NOON + 3_600_000 })]);
    expect(h.delivered).toHaveLength(0);
    expect(res.deferrals).toHaveLength(0); // dropped, not deferred
  });
});

describe('governor — busy + fullscreen (step 6)', () => {
  it('voice busy defers everything 30s', () => {
    const h = harness({ voiceBusy: true });
    const res = h.gov.process([candidate({ urgency: 'time-sensitive', dedupeKey: 'ts' })]);
    expect(h.delivered).toHaveLength(0);
    expect(res.deferrals[0]!.atMs).toBe(NOON + 30_000);
  });

  it('fullscreen delivers time-sensitive but defers others 10 min', () => {
    const h = harness({ fullscreen: true });
    const res = h.gov.process([
      candidate({ urgency: 'time-sensitive', dedupeKey: 'ts' }),
      candidate({ urgency: 'low', dedupeKey: 'lo' }),
    ]);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.group[0]!.urgency).toBe('time-sensitive');
    const lo = res.deferrals.find((d) => d.candidate.dedupeKey === 'lo')!;
    expect(lo.atMs).toBe(NOON + 10 * 60_000);
  });
});

describe('governor — spacing (step 7)', () => {
  it('non-time-sensitive deliveries are at least 20 min apart', () => {
    const h = harness();
    h.gov.process([candidate({ dedupeKey: 'first' })]);
    expect(h.delivered).toHaveLength(1);
    // 10 min later: within the 20-min window → deferred to first + 20 min
    h.clock.now = NOON + 10 * 60_000;
    const res = h.gov.process([candidate({ dedupeKey: 'second' })]);
    expect(h.delivered).toHaveLength(1);
    expect(res.deferrals[0]!.atMs).toBe(NOON + 20 * 60_000);
    // past the window → delivers
    h.clock.now = NOON + 21 * 60_000;
    h.gov.process([candidate({ dedupeKey: 'third' })]);
    expect(h.delivered).toHaveLength(2);
  });

  it('time-sensitive ignores spacing', () => {
    const h = harness();
    h.gov.process([candidate({ dedupeKey: 'a' })]);
    h.clock.now = NOON + 60_000;
    h.gov.process([candidate({ urgency: 'time-sensitive', dedupeKey: 'ts' })]);
    expect(h.delivered).toHaveLength(2);
  });
});

describe('governor — batching (step 8)', () => {
  it('merges survivors into one group, max 4, overflow deferred', () => {
    const h = harness();
    h.settings.proactive.maxPerDay = 20;
    const cands = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) =>
      candidate({ urgency: 'time-sensitive', dedupeKey: k }), // ts to avoid spacing between them
    );
    const res = h.gov.process(cands);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.group).toHaveLength(4);
    expect(res.deferrals).toHaveLength(2); // overflow
  });
});

describe('governor — auto-tune (step 10)', () => {
  // Seed prior deliveries on earlier days so they don't affect today's budget or spacing.
  function seedDismissals(h: Harness, ruleId: string, n: number, outcome: 'dismissed' | 'expired' = 'dismissed'): void {
    const DAY = 86_400_000;
    for (let i = 0; i < n; i++) {
      const at = NOON - (n - i) * DAY; // one per day, all in the past
      const row = h.repo.createIfAbsent({ ruleId, dedupeKey: `seed-${i}`, urgency: 'low', payload: { title: 't', body: '', actions: [] } }, at)!;
      h.repo.markShown(row.id, at);
      h.repo.recordOutcome(row.id, outcome, at);
    }
  }

  it('after 5 dismissals, the next candidate is replaced by a meta-nudge exactly once', () => {
    const h = harness();
    seedDismissals(h, 'overdue_todos', 5);
    h.gov.process([candidate({ ruleId: 'overdue_todos', dedupeKey: 'real1' })]);
    expect(h.delivered).toHaveLength(1);
    const meta = h.delivered[0]!.group[0]!;
    expect(meta.title).toContain('stop');
    expect(meta.actions.some((a) => a.id === 'disable')).toBe(true);

    // meta-nudge does not repeat the same day
    h.clock.now = NOON + 60_000;
    h.gov.process([candidate({ ruleId: 'overdue_todos', dedupeKey: 'real2' })]);
    const metaDeliveries = h.delivered.filter((d) => d.group[0]!.title.includes('stop'));
    expect(metaDeliveries).toHaveLength(1);
  });

  it('fewer than 5 negative outcomes does not trigger a meta-nudge', () => {
    const h = harness();
    seedDismissals(h, 'overdue_todos', 4);
    h.gov.process([candidate({ ruleId: 'overdue_todos', dedupeKey: 'real' })]);
    expect(h.delivered[0]!.group[0]!.title).not.toContain('stop');
  });

  it('a mix of outcomes (one acted) does not trigger auto-tune', () => {
    const h = harness();
    seedDismissals(h, 'overdue_todos', 4);
    // most recent outcome is 'acted', an hour ago (past the spacing window)
    const acted = h.repo.createIfAbsent({ ruleId: 'overdue_todos', dedupeKey: 'acted', urgency: 'low', payload: { title: 't', body: '', actions: [] } }, NOON - 3_600_000)!;
    h.repo.markShown(acted.id, NOON - 3_600_000);
    h.repo.recordOutcome(acted.id, 'acted', NOON - 3_600_000);
    h.gov.process([candidate({ ruleId: 'overdue_todos', dedupeKey: 'real' })]);
    expect(h.delivered[0]!.group[0]!.title).not.toContain('stop');
  });
});

describe('governor — master switch', () => {
  it('delivers nothing when proactive.enabled is false', () => {
    const h = harness();
    h.settings.proactive.enabled = false;
    const res = h.gov.process([candidate({ urgency: 'time-sensitive', dedupeKey: 'ts' })]);
    expect(h.delivered).toHaveLength(0);
    expect(res.deferrals).toHaveLength(0);
  });
});

describe('governor — perf (F7)', () => {
  it('processes a 50-candidate batch in under 10ms', () => {
    const h = harness();
    h.settings.proactive.maxPerDay = 20;
    const cands = Array.from({ length: 50 }, (_, i) => candidate({ urgency: 'time-sensitive', dedupeKey: `p${i}` }));
    const t0 = performance.now();
    h.gov.process(cands);
    expect(performance.now() - t0).toBeLessThan(10);
  });
});
