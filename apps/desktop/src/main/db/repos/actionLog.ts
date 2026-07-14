import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export type ActionOutcome = 'executed' | 'canceled' | 'denied' | 'expired' | 'undone';

export interface ActionLogRow {
  id: string; ts: number; tool: string; summary: string; outcome: ActionOutcome; convId: string | null;
}

interface Raw { id: string; ts: number; tool: string; summary: string; outcome: ActionOutcome; conv_id: string | null }
const toRow = (r: Raw): ActionLogRow => ({ id: r.id, ts: r.ts, tool: r.tool, summary: r.summary, outcome: r.outcome, convId: r.conv_id });

/** H3 action audit log: the user's accountability trail for external (Tier 3) actions
 *  and undos. Recipients are visible in the summary; message bodies never are. */
export function createActionLogRepo(db: Db) {
  return {
    record(input: { tool: string; summary: string; outcome: ActionOutcome; convId?: string | null }): void {
      db.prepare('INSERT INTO action_log(id,ts,tool,summary,outcome,conv_id) VALUES (?,?,?,?,?,?)').run(
        newId(), nowMs(), input.tool, input.summary, input.outcome, input.convId ?? null,
      );
    },
    recent(limit = 100): ActionLogRow[] {
      return (db.prepare('SELECT * FROM action_log ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit) as Raw[]).map(toRow);
    },
  };
}

export type ActionLogRepo = ReturnType<typeof createActionLogRepo>;
