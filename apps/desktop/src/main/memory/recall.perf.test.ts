import { beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { FakeEmbedder } from './embedder';
import { createRecall, type Recall } from './recall';

/**
 * G4 retrieval perf budget: recall.search end-to-end p95 under 150ms at 10,000
 * chunks, benchmarked with FakeEmbedder + real sqlite-vec.
 */
const N = 10_000;
let db: Db;
let repos: Repos;
let recall: Recall;

beforeAll(async () => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  const embedder = new FakeEmbedder();
  // Seed 10k embedded note chunks in batches.
  const words = ['drone', 'startup', 'dentist', 'budget', 'lake', 'house', 'rural', 'clinic', 'battery', 'garden', 'invoice', 'meeting'];
  const batch = 500;
  for (let i = 0; i < N; i += batch) {
    const texts: string[] = [];
    const ids: string[] = [];
    for (let j = 0; j < batch && i + j < N; j++) {
      const text = `Note ${i + j} about ${words[(i + j) % words.length]} and ${words[(i + j * 7) % words.length]} plans`;
      const rows = repos.chunks.replaceForRef('note', `n${i + j}`, [text], { ts: i + j });
      texts.push(text);
      ids.push(rows[0]!.id);
    }
    const vecs = await embedder.embed(texts);
    ids.forEach((id, k) => repos.chunks.setEmbedding(id, vecs[k]!));
  }
  recall = createRecall({ chunks: repos.chunks, repos, embedder });
}, 120_000);

describe('recall.search perf (G4)', () => {
  it(`p95 under 150ms over ${N} chunks`, async () => {
    const queries = ['drone startup plans', 'dentist budget', 'lake house rural', 'battery garden invoice', 'meeting clinic'];
    const times: number[] = [];
    // warm up
    await recall.search({ query: 'warmup drone', limit: 6 });
    for (let r = 0; r < 40; r++) {
      const q = queries[r % queries.length]!;
      const t0 = performance.now();
      await recall.search({ query: q, limit: 6 });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(`recall p95=${p95.toFixed(1)}ms median=${times[Math.floor(times.length / 2)]!.toFixed(1)}ms over ${N} chunks`);
    expect(p95).toBeLessThan(150);
  }, 60_000);
});
