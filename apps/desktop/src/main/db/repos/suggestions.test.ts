import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../connection';
import { migrate } from '../migrate';
import { createSuggestionsRepo, type SuggestionsRepo } from './suggestions';

let db: Db;
let repo: SuggestionsRepo;

const base = { title: 'Standup in 10 min', body: '9:30 AM', actions: [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' as const }] };

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repo = createSuggestionsRepo(db, { tz: () => 'America/Los_Angeles' });
});

describe('suggestionsRepo (F2)', () => {
  it('migration reaches version 3 with the suggestions table', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toContain('suggestions');
  });

  it('createIfAbsent dedupes on (ruleId, dedupeKey)', () => {
    const a = repo.createIfAbsent({ ruleId: 'meeting_lead', dedupeKey: 'ev1+100', urgency: 'time-sensitive', payload: base });
    expect(a).not.toBeNull();
    const dup = repo.createIfAbsent({ ruleId: 'meeting_lead', dedupeKey: 'ev1+100', urgency: 'time-sensitive', payload: base });
    expect(dup).toBeNull();
    // different dedupeKey is allowed
    expect(repo.createIfAbsent({ ruleId: 'meeting_lead', dedupeKey: 'ev1+200', urgency: 'time-sensitive', payload: base })).not.toBeNull();
    // same dedupeKey under a different rule is allowed
    expect(repo.createIfAbsent({ ruleId: 'other', dedupeKey: 'ev1+100', urgency: 'low', payload: base })).not.toBeNull();
  });

  it('dedupe holds across a simulated restart (persisted unique index)', () => {
    repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'k', urgency: 'low', payload: base });
    const repo2 = createSuggestionsRepo(db); // fresh repo over the same db
    expect(repo2.exists('r', 'k')).toBe(true);
    expect(repo2.createIfAbsent({ ruleId: 'r', dedupeKey: 'k', urgency: 'low', payload: base })).toBeNull();
  });

  it('countShownToday counts only shown low+normal within the local day', () => {
    const day = Date.parse('2026-07-13T12:00:00-07:00');
    const s1 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'a', urgency: 'normal', payload: base }, day)!;
    const s2 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'b', urgency: 'low', payload: base }, day)!;
    const ts = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'c', urgency: 'time-sensitive', payload: base }, day)!;
    repo.markShown(s1.id, day);
    repo.markShown(s2.id, day);
    repo.markShown(ts.id, day); // time-sensitive is exempt from the budget count
    expect(repo.countShownToday(day)).toBe(2);
    // a delivery on a different day does not count toward today
    const other = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'd', urgency: 'normal', payload: base }, Date.parse('2026-07-14T12:00:00-07:00'))!;
    repo.markShown(other.id, Date.parse('2026-07-14T12:00:00-07:00'));
    expect(repo.countShownToday(day)).toBe(2);
  });

  it('lastShownAt tracks the most recent non-time-sensitive delivery', () => {
    const s1 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'a', urgency: 'normal', payload: base })!;
    repo.markShown(s1.id, 1000);
    const s2 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'b', urgency: 'low', payload: base })!;
    repo.markShown(s2.id, 5000);
    const ts = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'c', urgency: 'time-sensitive', payload: base })!;
    repo.markShown(ts.id, 9000); // exempt from spacing
    expect(repo.lastShownAt()).toBe(5000);
  });

  it('recentOutcomes returns the last N recorded outcomes newest first', () => {
    for (let i = 0; i < 6; i++) {
      const s = repo.createIfAbsent({ ruleId: 'meeting_lead', dedupeKey: `k${i}`, urgency: 'low', payload: base })!;
      repo.recordOutcome(s.id, i % 2 === 0 ? 'dismissed' : 'acted', 1000 + i);
    }
    const last5 = repo.recentOutcomes('meeting_lead', 5);
    expect(last5).toHaveLength(5);
    expect(last5[0]).toBe('acted'); // newest is i=5 (odd) → 'acted'
  });

  it('markShown is idempotent and recordOutcome sticks', () => {
    const s = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'k', urgency: 'low', payload: base })!;
    expect(repo.markShown(s.id, 100)).toBe(true);
    expect(repo.markShown(s.id, 200)).toBe(false); // already shown
    expect(repo.get(s.id)?.shownAt).toBe(100);
    repo.recordOutcome(s.id, 'snoozed', 300);
    expect(repo.get(s.id)?.outcome).toBe('snoozed');
  });

  it('lastShown returns the most recently delivered suggestion (for "why did you ping me")', () => {
    const s1 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'a', urgency: 'low', payload: base })!;
    repo.markShown(s1.id, 100);
    const s2 = repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'b', urgency: 'normal', payload: { ...base, title: 'Newer' } })!;
    repo.markShown(s2.id, 500);
    expect(repo.lastShown()?.payload.title).toBe('Newer');
  });

  it('wipeAll clears everything (privacy wipe)', () => {
    repo.createIfAbsent({ ruleId: 'r', dedupeKey: 'k', urgency: 'low', payload: base });
    repo.wipeAll();
    expect(repo.recent(10)).toHaveLength(0);
  });
});
