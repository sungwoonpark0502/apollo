import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export const MEMORY_CATEGORIES = ['person', 'place', 'preference', 'schedule', 'work', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface MemoryFactRow {
  id: string; category: string; fact: string; sourceConvId: string | null;
  confidence: number; updatedAt: number; deletedAt: number | null;
}

interface Raw { id: string; category: string; fact: string; source_conv_id: string | null; confidence: number; updated_at: number; deleted_at: number | null }

function toRow(r: Raw): MemoryFactRow {
  return { id: r.id, category: r.category, fact: r.fact, sourceConvId: r.source_conv_id, confidence: r.confidence, updatedAt: r.updated_at, deletedAt: r.deleted_at };
}

export function createMemoryRepo(db: Db) {
  const byId = db.prepare('SELECT * FROM memory_facts WHERE id = ?');

  function get(id: string): MemoryFactRow | null {
    const r = byId.get(id) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  return {
    save(input: { category: MemoryCategory; fact: string; sourceConvId?: string | null; confidence?: number }): MemoryFactRow {
      const id = newId();
      db.prepare('INSERT INTO memory_facts(id,category,fact,source_conv_id,confidence,updated_at) VALUES (?,?,?,?,?,?)').run(
        id, input.category, input.fact, input.sourceConvId ?? null, input.confidence ?? 0.8, nowMs(),
      );
      const row = get(id);
      if (!row) throw new Error('insert failed');
      return row;
    },
    get,
    list(): MemoryFactRow[] {
      return (db.prepare('SELECT * FROM memory_facts WHERE deleted_at IS NULL ORDER BY updated_at DESC, rowid DESC').all() as Raw[]).map(toRow);
    },
    /** Newest facts first, budgeted by characters (≈4 chars/token; C8 caps digest at 600 tokens). */
    digest(maxChars = 2400): string {
      const lines: string[] = [];
      let used = 0;
      for (const f of (db.prepare('SELECT * FROM memory_facts WHERE deleted_at IS NULL ORDER BY updated_at DESC, rowid DESC').all() as Raw[]).map(toRow)) {
        const line = `- [${f.category}] ${f.fact}`;
        if (used + line.length + 1 > maxChars) break;
        lines.push(line);
        used += line.length + 1;
      }
      return lines.join('\n');
    },
    /** Best fuzzy match by shared tokens; soft-deletes and returns it, or null. */
    forgetFuzzy(fact: string): MemoryFactRow | null {
      const tokens = fact.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      if (!tokens.length) return null;
      let best: { row: MemoryFactRow; score: number } | null = null;
      for (const row of (db.prepare('SELECT * FROM memory_facts WHERE deleted_at IS NULL').all() as Raw[]).map(toRow)) {
        const f = row.fact.toLowerCase();
        const score = tokens.filter((t) => f.includes(t)).length / tokens.length;
        if (score >= 0.5 && (!best || score > best.score)) best = { row, score };
      }
      if (!best) return null;
      db.prepare('UPDATE memory_facts SET deleted_at=?, updated_at=? WHERE id=?').run(nowMs(), nowMs(), best.row.id);
      return best.row;
    },
    delete(id: string): boolean {
      return db.prepare('UPDATE memory_facts SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(nowMs(), nowMs(), id).changes > 0;
    },
    restore(id: string): boolean {
      return db.prepare('UPDATE memory_facts SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowMs(), id).changes > 0;
    },
  };
}

export type MemoryRepo = ReturnType<typeof createMemoryRepo>;
