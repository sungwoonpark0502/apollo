import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, vecAvailable, type Db } from '../connection';
import { migrate } from '../migrate';
import { createChunksRepo, type ChunksRepo } from './chunks';
import { FakeEmbedder } from '../../memory/embedder';

let db: Db;
let repo: ChunksRepo;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repo = createChunksRepo(db);
});

describe('sqlite-vec load + KNN (G2)', () => {
  it('the vector extension is available and migration created the tables', () => {
    expect(vecAvailable(db)).toBe(true);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toContain('chunks');
  });

  it('stores embeddings and returns nearest neighbours by vector distance', async () => {
    const e = new FakeEmbedder();
    const texts = ['the dentist appointment', 'grocery shopping list', 'quarterly budget review'];
    const rows = repo.replaceForRef('note', 'n1', texts, { ts: 1 });
    const vecs = await e.embed(texts);
    rows.forEach((r, i) => repo.setEmbedding(r.id, vecs[i]!));

    // querying with the exact vector of chunk 0 returns it first (distance ~0)
    const hits = repo.knn(vecs[0]!, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunkId).toBe(rows[0]!.id);
    expect(hits[0]!.distance).toBeLessThan(hits[hits.length - 1]!.distance + 1e-6);
  });

  it('replaceForRef removes old vectors so KNN never returns stale chunks', async () => {
    const e = new FakeEmbedder();
    const first = repo.replaceForRef('note', 'n1', ['original text here'], { ts: 1 });
    const [v0] = await e.embed(['original text here']);
    repo.setEmbedding(first[0]!.id, v0!);
    expect(repo.knn(v0!, 5).some((h) => h.chunkId === first[0]!.id)).toBe(true);

    // re-chunk the same ref → old vector gone
    const second = repo.replaceForRef('note', 'n1', ['completely new text'], { ts: 2 });
    const [v1] = await e.embed(['completely new text']);
    repo.setEmbedding(second[0]!.id, v1!);
    expect(repo.knn(v0!, 5).some((h) => h.chunkId === first[0]!.id)).toBe(false);
  });

  it('keyword search matches chunk text', () => {
    repo.replaceForRef('note', 'n1', ['the drone delivery startup idea'], { ts: 1 });
    repo.replaceForRef('note', 'n2', ['dentist appointment reminder'], { ts: 2 });
    const hits = repo.keywordSearch('drone startup', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain('drone');
  });

  it('purgeKind and purgeAll clear rows + vectors', async () => {
    const e = new FakeEmbedder();
    const rows = repo.replaceForRef('message', 'm1', ['a chat message'], { ts: 1 });
    repo.setEmbedding(rows[0]!.id, (await e.embed(['a chat message']))[0]!);
    repo.replaceForRef('note', 'n1', ['a note'], { ts: 1 });
    repo.purgeKind('message');
    expect(repo.countByKind().message).toBe(0);
    expect(repo.countByKind().note).toBe(1);
    repo.purgeAll();
    expect(repo.count()).toBe(0);
  });
});
