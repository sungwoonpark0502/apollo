import { DateTime } from 'luxon';
import { newId, nowMs, type SuggestionDTO, type Urgency } from '@apollo/shared';
import { type Db } from '../connection';

export type Outcome = 'acted' | 'dismissed' | 'snoozed' | 'expired';

export interface SuggestionRow {
  id: string;
  ruleId: string;
  dedupeKey: string;
  urgency: Urgency;
  payload: SuggestionDTO;
  createdAt: number;
  shownAt: number | null;
  outcome: Outcome | null;
  actedAt: number | null;
}

interface Raw {
  id: string; rule_id: string; dedupe_key: string; urgency: Urgency; payload: string;
  created_at: number; shown_at: number | null; outcome: Outcome | null; acted_at: number | null;
}

function toRow(r: Raw): SuggestionRow {
  return {
    id: r.id, ruleId: r.rule_id, dedupeKey: r.dedupe_key, urgency: r.urgency,
    payload: JSON.parse(r.payload) as SuggestionDTO,
    createdAt: r.created_at, shownAt: r.shown_at, outcome: r.outcome, actedAt: r.acted_at,
  };
}

/** F2 suggestionsRepo: dedupe by (rule_id, dedupe_key), mark shown, record outcome,
 *  count shown-today (budget), last-N outcomes per rule (auto-tune). */
export function createSuggestionsRepo(db: Db, opts: { tz?: () => string } = {}) {
  const tz = opts.tz ?? (() => 'UTC');

  const byId = db.prepare('SELECT * FROM suggestions WHERE id = ?');

  function get(id: string): SuggestionRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  function dayBounds(atMs: number): { start: number; end: number } {
    const day = DateTime.fromMillis(atMs, { zone: tz() });
    return { start: day.startOf('day').toMillis(), end: day.endOf('day').toMillis() };
  }

  return {
    get,

    exists(ruleId: string, dedupeKey: string): boolean {
      return db.prepare('SELECT 1 FROM suggestions WHERE rule_id=? AND dedupe_key=? LIMIT 1').get(ruleId, dedupeKey) !== undefined;
    },

    /** Create-if-absent by (ruleId, dedupeKey). Returns the row, or null if it already existed. */
    createIfAbsent(input: {
      ruleId: string; dedupeKey: string; urgency: Urgency; payload: Omit<SuggestionDTO, 'id' | 'createdAt' | 'ruleId' | 'urgency'>;
    }, at: number = nowMs()): SuggestionRow | null {
      if (this.exists(input.ruleId, input.dedupeKey)) return null;
      const id = newId();
      const dto: SuggestionDTO = { ...input.payload, id, ruleId: input.ruleId, urgency: input.urgency, createdAt: at };
      try {
        db.prepare(
          'INSERT INTO suggestions(id,rule_id,dedupe_key,urgency,payload,created_at) VALUES (?,?,?,?,?,?)',
        ).run(id, input.ruleId, input.dedupeKey, input.urgency, JSON.stringify(dto), at);
      } catch {
        return null; // unique-index race: treat as already present
      }
      return get(id);
    },

    markShown(id: string, at: number = nowMs()): boolean {
      return db.prepare('UPDATE suggestions SET shown_at=? WHERE id=? AND shown_at IS NULL').run(at, id).changes > 0;
    },

    recordOutcome(id: string, outcome: Outcome, at: number = nowMs()): boolean {
      return db.prepare('UPDATE suggestions SET outcome=?, acted_at=? WHERE id=?').run(outcome, at, id).changes > 0;
    },

    /** Count of low+normal suggestions shown today (budget; time-sensitive is exempt). */
    countShownToday(at: number = nowMs()): number {
      const { start, end } = dayBounds(at);
      const r = db
        .prepare(
          "SELECT COUNT(*) AS c FROM suggestions WHERE shown_at IS NOT NULL AND urgency IN ('low','normal') AND shown_at BETWEEN ? AND ?",
        )
        .get(start, end) as { c: number };
      return r.c;
    },

    /** Most recent non-time-sensitive delivery timestamp (rate spacing). */
    lastShownAt(): number | null {
      const r = db
        .prepare("SELECT MAX(shown_at) AS m FROM suggestions WHERE shown_at IS NOT NULL AND urgency IN ('low','normal')")
        .get() as { m: number | null };
      return r.m;
    },

    /** Last N recorded outcomes for a rule, newest first (auto-tune). */
    recentOutcomes(ruleId: string, n: number): Outcome[] {
      return (
        db
          .prepare('SELECT outcome FROM suggestions WHERE rule_id=? AND outcome IS NOT NULL ORDER BY acted_at DESC, created_at DESC LIMIT ?')
          .all(ruleId, n) as Array<{ outcome: Outcome }>
      ).map((x) => x.outcome);
    },

    /** For proactive.status / "why did you ping me" — the most recent shown suggestion. */
    lastShown(): SuggestionRow | null {
      const r = db.prepare('SELECT * FROM suggestions WHERE shown_at IS NOT NULL ORDER BY shown_at DESC LIMIT 1').get() as Raw | undefined;
      return r ? toRow(r) : null;
    },

    /** Recent suggestions for the Settings "Recent nudges" list. */
    recent(limit: number): SuggestionRow[] {
      return (db.prepare('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT ?').all(limit) as Raw[]).map(toRow);
    },

    /** When did the last meta-nudge for a rule fire? (auto-tune 30-day cap). */
    lastMetaNudgeAt(ruleId: string): number | null {
      const r = db
        .prepare("SELECT MAX(created_at) AS m FROM suggestions WHERE rule_id=? AND dedupe_key LIKE 'meta:%'")
        .get(ruleId) as { m: number | null };
      return r.m;
    },

    wipeAll(): void {
      db.prepare('DELETE FROM suggestions').run();
    },
  };
}

export type SuggestionsRepo = ReturnType<typeof createSuggestionsRepo>;
