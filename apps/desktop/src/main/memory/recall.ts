import { DateTime } from 'luxon';
import { type RecallItem } from '@apollo/shared';
import { type ChunksRepo, type ChunkKind, type ChunkRow } from '../db/repos/chunks';
import { type Repos } from '../db/repos/index';
import { type Embedder } from './embedder';

const KNN_K = 24;
const KW_K = 24;
const VEC_WEIGHT = 0.75;
const KW_WEIGHT = 0.25;

export interface RankCandidate {
  chunkId: string;
  refId: string;
  kind: ChunkKind;
  ts: number;
  cosine: number;        // 0 if not in the vector top-K
  keywordScore: number;  // 0..1, 0 if not in the keyword pass
}

/** G4 step 4–6: blend scores, apply recency, collapse to best chunk per ref_id, take top `limit`. */
export function rankCandidates(cands: RankCandidate[], now: number, limit: number): RankCandidate[] {
  const scored = cands.map((c) => {
    const base = VEC_WEIGHT * c.cosine + KW_WEIGHT * c.keywordScore;
    const ageDays = Math.max(0, (now - c.ts) / 86_400_000);
    const recency = 0.7 + 0.3 * Math.exp(-ageDays / 45);
    return { c, score: base * recency };
  });
  // collapse to the best chunk per ref_id
  const bestByRef = new Map<string, { c: RankCandidate; score: number }>();
  for (const s of scored) {
    const prev = bestByRef.get(s.c.refId);
    if (!prev || s.score > prev.score) bestByRef.set(s.c.refId, s);
  }
  return [...bestByRef.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.c);
}

/** L2 distance (sqlite-vec default) → cosine for L2-normalized vectors. */
export function l2ToCosine(distance: number): number {
  return 1 - (distance * distance) / 2;
}

/** Fraction of query terms present in the chunk text (deterministic keywordScore in 0..1). */
export function keywordScore(query: string, text: string): number {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 1))];
  if (terms.length === 0) return 0;
  const lc = text.toLowerCase();
  const hits = terms.filter((t) => lc.includes(t)).length;
  return hits / terms.length;
}

export interface RecallDeps {
  chunks: ChunksRepo;
  repos: Repos;
  embedder: Embedder;
  now?: () => number;
}

export interface RecallParams {
  query: string;
  kinds?: ChunkKind[];
  sinceIso?: string;
  limit: number;
}

function titleFor(row: ChunkRow, repos: Repos): string {
  if (row.kind === 'note') {
    const note = repos.notes.get(row.refId);
    const first = (note?.content ?? row.text).split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    return (first ?? 'Untitled').slice(0, 80);
  }
  if (row.kind === 'fact') {
    const colon = row.text.indexOf(':');
    return colon > 0 ? row.text.slice(0, colon) : 'Memory';
  }
  return 'Chat';
}

function snippetFor(row: ChunkRow): string {
  const clean = row.text.replace(/\s+/g, ' ').trim();
  return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
}

/** Full hybrid retrieval used by both recall.search (tool) and recall.query (IPC). */
export function createRecall(deps: RecallDeps) {
  const now = deps.now ?? Date.now;

  return {
    async search(params: RecallParams): Promise<RecallItem[]> {
      const sinceTs = params.sinceIso ? DateTime.fromISO(params.sinceIso).toMillis() : null;
      const kindSet = params.kinds && params.kinds.length ? new Set<ChunkKind>(params.kinds) : null;

      const inScope = (row: ChunkRow): boolean =>
        (!kindSet || kindSet.has(row.kind)) && (sinceTs === null || row.ts >= sinceTs);

      // (1) embed query; (2) vector KNN top 24
      const [queryVec] = await deps.embedder.embed([params.query]);
      const knn = queryVec ? deps.chunks.knn(queryVec, KNN_K) : [];
      const cosineById = new Map<string, number>();
      for (const h of knn) cosineById.set(h.chunkId, l2ToCosine(h.distance));

      // (3) keyword pass top 24
      const kwRows = deps.chunks.keywordSearch(params.query, KW_K);

      // hydrate + merge by chunk id
      const ids = new Set<string>([...cosineById.keys(), ...kwRows.map((r) => r.id)]);
      const rows = deps.chunks.byIds([...ids]).filter(inScope);
      const rowById = new Map(rows.map((r) => [r.id, r]));

      const candidates: RankCandidate[] = [];
      for (const row of rows) {
        candidates.push({
          chunkId: row.id,
          refId: row.refId,
          kind: row.kind,
          ts: row.ts,
          cosine: cosineById.get(row.id) ?? 0,
          keywordScore: keywordScore(params.query, row.text),
        });
      }

      const ranked = rankCandidates(candidates, now(), params.limit);
      return ranked.map((c) => {
        const row = rowById.get(c.chunkId)!;
        return { chunkId: row.id, kind: row.kind, refId: row.refId, title: titleFor(row, deps.repos), snippet: snippetFor(row), ts: row.ts };
      });
    },
  };
}

export type Recall = ReturnType<typeof createRecall>;

/** G4 llmText: numbered plain-text list, e.g. `1. [note, Jul 3] "…snippet…"`. */
export function formatRecallLlmText(query: string, items: RecallItem[], tz: string): string {
  if (items.length === 0) return `No matches found in notes, chats, or memory for "${query}".`;
  return items
    .map((it, i) => {
      const date = DateTime.fromMillis(it.ts, { zone: tz }).toFormat('LLL d');
      return `${i + 1}. [${it.kind}, ${date}] "${it.snippet}"`;
    })
    .join('\n');
}
