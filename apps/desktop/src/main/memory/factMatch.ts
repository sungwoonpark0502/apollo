import { cosine, type Embedder } from './embedder';

/** G5 thresholds. >0.90 near-duplicate (update in place); 0.75–0.90 contradiction
 *  (replace: soft-delete old + insert new); below → fresh insert. */
export const FACT_UPDATE_THRESHOLD = 0.9;
export const FACT_REPLACE_THRESHOLD = 0.75;
export const FORGET_THRESHOLD = 0.6;

export type FactAction = 'insert' | 'update' | 'replace';

export function decideFactAction(maxCosine: number): FactAction {
  if (maxCosine > FACT_UPDATE_THRESHOLD) return 'update';
  if (maxCosine >= FACT_REPLACE_THRESHOLD) return 'replace';
  return 'insert';
}

export interface FactCandidate {
  id: string;
  fact: string;
}

export interface FactMatch {
  action: FactAction;
  target: FactCandidate | null; // the best same-category match (null when inserting fresh)
  cosine: number;
}

/** Embeds the new fact + all same-category candidates, returns the merge decision. */
export async function matchFact(embedder: Embedder, newFact: string, candidates: FactCandidate[]): Promise<FactMatch> {
  if (candidates.length === 0) return { action: 'insert', target: null, cosine: 0 };
  const vecs = await embedder.embed([newFact, ...candidates.map((c) => c.fact)]);
  const newVec = vecs[0];
  if (!newVec) return { action: 'insert', target: null, cosine: 0 };
  let best: FactCandidate | null = null;
  let maxCos = -1;
  for (let i = 0; i < candidates.length; i++) {
    const v = vecs[i + 1];
    if (!v) continue;
    const c = cosine(newVec, v);
    if (c > maxCos) {
      maxCos = c;
      best = candidates[i]!;
    }
  }
  return { action: decideFactAction(maxCos), target: best, cosine: maxCos };
}

/** G5 forget: best same-meaning fact (top 1, cosine > 0.6), else the 3 nearest as candidates. */
export async function resolveForget(
  embedder: Embedder,
  query: string,
  candidates: FactCandidate[],
): Promise<{ hit: FactCandidate | null; nearest: FactCandidate[] }> {
  if (candidates.length === 0) return { hit: null, nearest: [] };
  const vecs = await embedder.embed([query, ...candidates.map((c) => c.fact)]);
  const qVec = vecs[0];
  if (!qVec) return { hit: null, nearest: [] };
  const scored = candidates
    .map((c, i) => ({ c, score: vecs[i + 1] ? cosine(qVec, vecs[i + 1]!) : -1 }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top && top.score > FORGET_THRESHOLD) return { hit: top.c, nearest: [] };
  return { hit: null, nearest: scored.slice(0, 3).map((s) => s.c) };
}
