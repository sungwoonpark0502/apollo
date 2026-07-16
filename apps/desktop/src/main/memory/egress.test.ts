import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { FakeEmbedder } from './embedder';
import { createRecall } from './recall';
import { createIndexer } from './indexer';
import { createFakeClock } from '../proactive/fakeClock';
import { BASE_ALLOWED_HOSTS } from '../net/egress';

/**
 * G8 egress guard: embedding and retrieval must make ZERO network attempts.
 * We spy on global fetch and assert it is never called during index + recall,
 * and separately confirm the runtime allowlist (C14.9) is unchanged by Part G.
 */
let db: Db;
let repos: Repos;
let fetchSpy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  fetchSpy = vi.fn(() => Promise.reject(new Error('network blocked in test')));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('no network egress during embed + recall (G8)', () => {
  it('indexing and recall never call fetch', async () => {
    const clock = createFakeClock(1_000_000);
    const indexer = createIndexer({
      repos,
      embedder: new FakeEmbedder(),
      historyEnabled: () => true,
      canDrain: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    indexer.start();
    repos.notes.save({ content: 'Drone delivery startup idea for rural clinics' });
    clock.advance(5_000); // note debounce → chunk
    clock.advance(1); // pump → embed
    await flush();

    const recall = createRecall({ chunks: repos.chunks, repos, embedder: new FakeEmbedder() });
    const items = await recall.search({ query: 'drone startup', limit: 6 });
    expect(items.length).toBeGreaterThanOrEqual(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    indexer.stop();
  });

  it('the runtime egress allowlist stays the C14.9 Google-family set (I7 adds only the Calendar API host)', () => {
    // Embedding/recall (Part G) add no host. I7 adds www.googleapis.com (Google
    // Calendar API) — a first-party Google host, no wildcard, no arbitrary egress.
    expect(BASE_ALLOWED_HOSTS).toEqual([
      'api.anthropic.com',
      'api.deepgram.com',
      'api.search.brave.com',
      'api.open-meteo.com',
      'geocoding-api.open-meteo.com',
      'gmail.googleapis.com',
      'www.googleapis.com',
      'oauth2.googleapis.com',
      'accounts.google.com',
      'speech.platform.bing.com',
    ]);
    expect(BASE_ALLOWED_HOSTS).not.toContain('huggingface.co');
  });
});
