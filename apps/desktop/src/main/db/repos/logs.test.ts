import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../connection';
import { migrate } from '../migrate';
import { createActionLogRepo, type ActionLogRepo } from './actionLog';
import { createUsageLogRepo, type UsageLogRepo } from './usageLog';

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});

describe('action_log (H3)', () => {
  let repo: ActionLogRepo;
  beforeEach(() => { repo = createActionLogRepo(db); });

  it('records outcomes and returns newest first, capped', () => {
    repo.record({ tool: 'email.send', summary: 'Send email to jane@x.com', outcome: 'executed', convId: 'c1' });
    repo.record({ tool: 'email.send', summary: 'Send email to bob@y.com', outcome: 'denied', convId: 'c1' });
    const rows = repo.recent(100);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.summary).toContain('bob'); // newest first
    expect(rows[0]!.outcome).toBe('denied');
  });

  it('respects the row limit', () => {
    for (let i = 0; i < 150; i++) repo.record({ tool: 'undo.last', summary: `undo ${i}`, outcome: 'undone' });
    expect(repo.recent(100)).toHaveLength(100);
  });
});

describe('usage_log (H4)', () => {
  let repo: UsageLogRepo;
  beforeEach(() => { repo = createUsageLogRepo(db, { tz: () => 'America/Los_Angeles' }); });

  it('upserts by (day, provider, metric) accumulating amounts', () => {
    const t = Date.parse('2026-07-14T12:00:00-07:00');
    repo.add('anthropic', 'inputTokens', 100, t);
    repo.add('anthropic', 'inputTokens', 50, t);
    repo.add('anthropic', 'outputTokens', 30, t);
    expect(repo.todayTotal('anthropic', 'inputTokens', t)).toBe(150);
    expect(repo.todayTotal('anthropic', 'outputTokens', t)).toBe(30);
  });

  it('separates by local day', () => {
    const d1 = Date.parse('2026-07-14T12:00:00-07:00');
    const d2 = Date.parse('2026-07-15T12:00:00-07:00');
    repo.add('deepgram', 'seconds', 10, d1);
    repo.add('deepgram', 'seconds', 20, d2);
    expect(repo.todayTotal('deepgram', 'seconds', d1)).toBe(10);
    expect(repo.todayTotal('deepgram', 'seconds', d2)).toBe(20);
  });

  it('ignores non-positive amounts', () => {
    const t = Date.now();
    repo.add('anthropic', 'inputTokens', 0, t);
    repo.add('anthropic', 'inputTokens', -5, t);
    expect(repo.todayTotal('anthropic', 'inputTokens', t)).toBe(0);
  });

  it('month() aggregates across days of the month', () => {
    const d1 = Date.parse('2026-07-01T12:00:00-07:00');
    const d2 = Date.parse('2026-07-20T12:00:00-07:00');
    repo.add('anthropic', 'inputTokens', 100, d1);
    repo.add('anthropic', 'inputTokens', 200, d2);
    const m = repo.month(d2).find((r) => r.metric === 'inputTokens');
    expect(m?.amount).toBe(300);
  });
});
