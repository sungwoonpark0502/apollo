import { describe, expect, it } from 'vitest';
import { shouldWarnUsage } from './usageWarn';

describe('usage warn-once (H4)', () => {
  it('does not warn when no limit is set', () => {
    expect(shouldWarnUsage({ todayTotalTokens: 999_999, limit: null, today: '2026-07-14', lastWarnedDay: null }).warn).toBe(false);
  });

  it('does not warn below the limit', () => {
    expect(shouldWarnUsage({ todayTotalTokens: 500, limit: 1000, today: '2026-07-14', lastWarnedDay: null }).warn).toBe(false);
  });

  it('warns once when the limit is crossed and records the day', () => {
    const r = shouldWarnUsage({ todayTotalTokens: 1200, limit: 1000, today: '2026-07-14', lastWarnedDay: null });
    expect(r.warn).toBe(true);
    expect(r.lastWarnedDay).toBe('2026-07-14');
  });

  it('does not warn again the same day', () => {
    expect(shouldWarnUsage({ todayTotalTokens: 5000, limit: 1000, today: '2026-07-14', lastWarnedDay: '2026-07-14' }).warn).toBe(false);
  });

  it('warns again on a new day', () => {
    const r = shouldWarnUsage({ todayTotalTokens: 1200, limit: 1000, today: '2026-07-15', lastWarnedDay: '2026-07-14' });
    expect(r.warn).toBe(true);
    expect(r.lastWarnedDay).toBe('2026-07-15');
  });
});
