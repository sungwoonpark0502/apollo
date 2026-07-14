import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { FakeEmbedder, type Embedder } from './embedder';
import { createRecall, formatRecallLlmText, keywordScore, l2ToCosine, rankCandidates, type RankCandidate } from './recall';

const DAY = 86_400_000;

describe('ranking math (G4)', () => {
  const base = { chunkId: '', refId: '', kind: 'note' as const, ts: 0, cosine: 0, keywordScore: 0 };

  it('blends 0.75*cosine + 0.25*keyword and orders by score', () => {
    const now = 0;
    const cands: RankCandidate[] = [
      { ...base, chunkId: 'a', refId: 'a', cosine: 0.9, keywordScore: 0 },
      { ...base, chunkId: 'b', refId: 'b', cosine: 0.5, keywordScore: 1 },
      { ...base, chunkId: 'c', refId: 'c', cosine: 0.2, keywordScore: 0.2 },
    ];
    const ranked = rankCandidates(cands, now, 3);
    // a: .675, b: .625, c: .2 → a, b, c
    expect(ranked.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('applies recency decay: newer wins on equal base score', () => {
    const now = 100 * DAY;
    const cands: RankCandidate[] = [
      { ...base, chunkId: 'old', refId: 'old', cosine: 0.8, ts: 0 },
      { ...base, chunkId: 'new', refId: 'new', cosine: 0.8, ts: 100 * DAY },
    ];
    const ranked = rankCandidates(cands, now, 2);
    expect(ranked[0]!.chunkId).toBe('new');
  });

  it('collapses to the best chunk per ref_id', () => {
    const cands: RankCandidate[] = [
      { ...base, chunkId: 'c1', refId: 'note1', cosine: 0.4 },
      { ...base, chunkId: 'c2', refId: 'note1', cosine: 0.9 }, // better chunk of same note
      { ...base, chunkId: 'c3', refId: 'note2', cosine: 0.6 },
    ];
    const ranked = rankCandidates(cands, 0, 10);
    expect(ranked).toHaveLength(2);
    expect(ranked.find((r) => r.refId === 'note1')!.chunkId).toBe('c2');
  });

  it('l2ToCosine inverts the normalized-vector distance relation', () => {
    expect(l2ToCosine(0)).toBeCloseTo(1, 5); // identical
    expect(l2ToCosine(Math.SQRT2)).toBeCloseTo(0, 5); // orthogonal (L2=sqrt2)
  });

  it('keywordScore is the fraction of query terms present', () => {
    expect(keywordScore('drone startup idea', 'the drone startup pitch')).toBeCloseTo(2 / 3, 5);
    expect(keywordScore('nothing here', 'unrelated text')).toBe(0);
  });

  it('formatRecallLlmText numbers results and handles empty', () => {
    expect(formatRecallLlmText('x', [], 'UTC')).toContain('No matches found');
    const txt = formatRecallLlmText('x', [{ chunkId: 'c', kind: 'note', refId: 'n', title: 'T', snippet: 'hello', ts: 0 }], 'UTC');
    expect(txt).toMatch(/^1\. \[note, .+\] "hello"$/);
  });
});

describe('recall end-to-end over sqlite-vec (FakeEmbedder)', () => {
  let db: Db;
  let repos: Repos;
  let embedder: Embedder;

  beforeEach(async () => {
    db = openDb(':memory:');
    migrate(db);
    repos = createRepos(db);
    embedder = new FakeEmbedder();
    // seed three notes as chunks and embed them
    const seed = async (refId: string, text: string, ts: number): Promise<void> => {
      const rows = repos.chunks.replaceForRef('note', refId, [text], { ts });
      const [v] = await embedder.embed([text]);
      repos.chunks.setEmbedding(rows[0]!.id, v!);
      repos.notes.save({ content: text }); // so titleFor can resolve (best-effort)
    };
    await seed('n1', 'Drone delivery startup idea for rural areas', 5 * DAY);
    await seed('n2', 'Grocery shopping list milk eggs bread', 4 * DAY);
    await seed('n3', 'Quarterly budget review meeting notes', 3 * DAY);
  });

  it('returns a keyword-matched note and shapes recallList items', async () => {
    const recall = createRecall({ chunks: repos.chunks, repos, embedder, now: () => 6 * DAY });
    const items = await recall.search({ query: 'drone startup', limit: 6 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.kind).toBe('note');
    expect(items[0]!.snippet.toLowerCase()).toContain('drone');
    expect(items[0]!.title.length).toBeGreaterThan(0);
  });

  it('respects the kinds filter (facts only → no note results)', async () => {
    const recall = createRecall({ chunks: repos.chunks, repos, embedder, now: () => 6 * DAY });
    const items = await recall.search({ query: 'drone startup', kinds: ['fact'], limit: 6 });
    expect(items.every((i) => i.kind === 'fact')).toBe(true);
  });

  it('respects sinceIso (excludes older chunks)', async () => {
    const recall = createRecall({ chunks: repos.chunks, repos, embedder, now: () => 6 * DAY });
    const since = new Date(4.5 * DAY).toISOString();
    const items = await recall.search({ query: 'list budget drone', sinceIso: since, limit: 6 });
    expect(items.every((i) => i.ts >= 4.5 * DAY)).toBe(true);
  });
});
