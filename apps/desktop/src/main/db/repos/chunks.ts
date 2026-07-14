import { newId, nowMs } from '@apollo/shared';
import { type Db, vecAvailable } from '../connection';

export type ChunkKind = 'note' | 'message' | 'fact';

export interface ChunkRow {
  id: string;
  kind: ChunkKind;
  refId: string;
  convId: string | null;
  text: string;
  ts: number;
  embeddedAt: number | null;
}

interface Raw {
  id: string; kind: ChunkKind; ref_id: string; conv_id: string | null; text: string; ts: number; embedded_at: number | null;
}
const toRow = (r: Raw): ChunkRow => ({ id: r.id, kind: r.kind, refId: r.ref_id, convId: r.conv_id, text: r.text, ts: r.ts, embeddedAt: r.embedded_at });

export interface KnnHit { chunkId: string; distance: number }

/** G2 chunks + vector store. SQL lives here only; vectors go through sqlite-vec. */
export function createChunksRepo(db: Db) {
  const hasVec = vecAvailable(db);

  const insert = db.prepare('INSERT INTO chunks(id,kind,ref_id,conv_id,text,ts,embedded_at) VALUES (?,?,?,?,?,?,NULL)');
  const delByRef = db.prepare('DELETE FROM chunks WHERE kind=? AND ref_id=?');
  const idsByRef = db.prepare('SELECT id FROM chunks WHERE kind=? AND ref_id=?');
  const setEmbedded = db.prepare('UPDATE chunks SET embedded_at=? WHERE id=?');
  const vecInsert = hasVec ? db.prepare('INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)') : null;
  const vecDelete = hasVec ? db.prepare('DELETE FROM vec_chunks WHERE chunk_id=?') : null;

  function removeVectors(ids: string[]): void {
    if (!vecDelete) return;
    for (const id of ids) vecDelete.run(id);
  }

  return {
    vecAvailable: hasVec,

    /** Replace all chunks for a (kind, refId): delete old rows+vectors, insert new unembedded rows. */
    replaceForRef(kind: ChunkKind, refId: string, texts: string[], opts: { convId?: string | null; ts: number }): ChunkRow[] {
      const existing = (idsByRef.all(kind, refId) as Array<{ id: string }>).map((r) => r.id);
      removeVectors(existing);
      delByRef.run(kind, refId);
      const rows: ChunkRow[] = [];
      const tx = db.transaction(() => {
        for (const text of texts) {
          const id = newId();
          insert.run(id, kind, refId, opts.convId ?? null, text, opts.ts);
          rows.push({ id, kind, refId, convId: opts.convId ?? null, text, ts: opts.ts, embeddedAt: null });
        }
      });
      tx();
      return rows;
    },

    removeForRef(kind: ChunkKind, refId: string): void {
      const existing = (idsByRef.all(kind, refId) as Array<{ id: string }>).map((r) => r.id);
      removeVectors(existing);
      delByRef.run(kind, refId);
    },

    /** Store a vector for a chunk and mark it embedded. */
    setEmbedding(chunkId: string, embedding: Float32Array, at: number = nowMs()): void {
      if (vecInsert) {
        vecDelete?.run(chunkId);
        vecInsert.run(chunkId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
      }
      setEmbedded.run(at, chunkId);
    },

    pendingEmbedding(limit: number): ChunkRow[] {
      return (db.prepare('SELECT * FROM chunks WHERE embedded_at IS NULL ORDER BY ts LIMIT ?').all(limit) as Raw[]).map(toRow);
    },

    get(id: string): ChunkRow | null {
      const r = db.prepare('SELECT * FROM chunks WHERE id=?').get(id) as Raw | undefined;
      return r ? toRow(r) : null;
    },

    count(): number {
      return (db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number }).c;
    },

    /** Rough on-disk footprint: chunk text bytes + one float32[384] vector per embedded chunk. */
    sizeBytes(): number {
      const textBytes = (db.prepare('SELECT COALESCE(SUM(LENGTH(text)),0) AS b FROM chunks').get() as { b: number }).b;
      const embedded = (db.prepare('SELECT COUNT(*) AS c FROM chunks WHERE embedded_at IS NOT NULL').get() as { c: number }).c;
      return textBytes + embedded * 384 * 4;
    },

    countByKind(): Record<ChunkKind, number> {
      const rows = db.prepare('SELECT kind, COUNT(*) AS c FROM chunks GROUP BY kind').all() as Array<{ kind: ChunkKind; c: number }>;
      const out: Record<ChunkKind, number> = { note: 0, message: 0, fact: 0 };
      for (const r of rows) out[r.kind] = r.c;
      return out;
    },

    /** Vector KNN over vec_chunks; returns nearest chunkIds with cosine distance. */
    knn(query: Float32Array, k: number): KnnHit[] {
      if (!hasVec) return [];
      const rows = db
        .prepare('SELECT chunk_id AS chunkId, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?')
        .all(Buffer.from(query.buffer, query.byteOffset, query.byteLength), k) as KnnHit[];
      return rows;
    },

    /** Keyword LIKE pass over chunk text (fallback + hybrid blend). */
    keywordSearch(query: string, k: number): ChunkRow[] {
      const terms = query.split(/\s+/).filter((t) => t.length > 1).slice(0, 6);
      if (terms.length === 0) return [];
      const where = terms.map(() => 'text LIKE ?').join(' OR ');
      const args = terms.map((t) => `%${t}%`);
      return (db.prepare(`SELECT * FROM chunks WHERE ${where} ORDER BY ts DESC LIMIT ?`).all(...args, k) as Raw[]).map(toRow);
    },

    /** Rows by id, for hydrating ranked results. */
    byIds(ids: string[]): ChunkRow[] {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      return (db.prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`).all(...ids) as Raw[]).map(toRow);
    },

    /** G3 growth-cap pruning: drop oldest message chunks first; never note/fact. */
    pruneOldestMessages(n: number): number {
      const victims = db.prepare("SELECT id FROM chunks WHERE kind='message' ORDER BY ts ASC LIMIT ?").all(n) as Array<{ id: string }>;
      const ids = victims.map((v) => v.id);
      removeVectors(ids);
      for (const id of ids) db.prepare('DELETE FROM chunks WHERE id=?').run(id);
      return ids.length;
    },

    purgeKind(kind: ChunkKind): void {
      const ids = (db.prepare('SELECT id FROM chunks WHERE kind=?').all(kind) as Array<{ id: string }>).map((r) => r.id);
      removeVectors(ids);
      db.prepare('DELETE FROM chunks WHERE kind=?').run(kind);
    },

    purgeAll(): void {
      if (vecDelete) db.exec('DELETE FROM vec_chunks');
      db.exec('DELETE FROM chunks');
    },
  };
}

export type ChunksRepo = ReturnType<typeof createChunksRepo>;
