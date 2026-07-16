import { DateTime } from 'luxon';
import { monthKey } from '@apollo/shared';
import { type Db } from '../connection';

export interface UsageRow { day: string; provider: string; metric: string; amount: number }

/** H4 usage metering: per-local-day upserts of provider metrics (Anthropic tokens,
 *  Deepgram seconds, TTS characters). */
export function createUsageLogRepo(db: Db, opts: { tz?: () => string } = {}) {
  const tz = opts.tz ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const dayOf = (atMs: number): string => DateTime.fromMillis(atMs, { zone: tz() }).toISODate() ?? '1970-01-01';

  return {
    add(provider: string, metric: string, amount: number, at: number = Date.now()): void {
      if (!amount || amount <= 0) return;
      db.prepare(
        `INSERT INTO usage_log(day,provider,metric,amount) VALUES (?,?,?,?)
         ON CONFLICT(day,provider,metric) DO UPDATE SET amount = amount + excluded.amount`,
      ).run(dayOf(at), provider, metric, amount);
    },
    today(at: number = Date.now()): UsageRow[] {
      return db.prepare('SELECT * FROM usage_log WHERE day=?').all(dayOf(at)) as UsageRow[];
    },
    month(at: number = Date.now()): UsageRow[] {
      const prefix = `${monthKey(at, tz())}-%`;
      return db.prepare('SELECT provider, metric, SUM(amount) AS amount, MAX(day) AS day FROM usage_log WHERE day LIKE ? GROUP BY provider, metric').all(prefix) as UsageRow[];
    },
    /** Total for a provider+metric on a given local day (usage-limit warn check). */
    todayTotal(provider: string, metric: string, at: number = Date.now()): number {
      const r = db.prepare('SELECT amount FROM usage_log WHERE day=? AND provider=? AND metric=?').get(dayOf(at), provider, metric) as { amount: number } | undefined;
      return r?.amount ?? 0;
    },
  };
}

export type UsageLogRepo = ReturnType<typeof createUsageLogRepo>;
