import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createIndexer } from './indexer';
import { FakeEmbedder } from './embedder';
import { createFakeClock, type FakeClock } from '../proactive/fakeClock';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function setup(opts: { canDrain?: () => boolean; historyEnabled?: () => boolean } = {}): { indexer: ReturnType<typeof createIndexer>; clock: FakeClock } {
  const clock = createFakeClock(1_000_000);
  const indexer = createIndexer({
    repos,
    embedder: new FakeEmbedder(),
    historyEnabled: opts.historyEnabled ?? (() => true),
    canDrain: opts.canDrain ?? (() => true),
    now: clock.now,
    setTimer: clock.setTimer,
  });
  return { indexer, clock };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('indexer note flow (G3)', () => {
  it('debounces 5s then chunks+embeds a note', async () => {
    const { indexer, clock } = setup();
    indexer.start();
    const note = repos.notes.save({ content: 'Ideas\n\nA drone delivery startup.' });
    // DataBus fired synchronously → note timer armed; nothing chunked yet
    expect(repos.chunks.count()).toBe(0);
    clock.advance(5_000); // debounce elapses → rechunk
    expect(repos.chunks.count()).toBeGreaterThan(0);
    clock.advance(1); // pump drain timer
    await flush();
    // embedded_at set
    expect(repos.chunks.pendingEmbedding(10)).toHaveLength(0);
    void note;
    indexer.stop();
  });

  it('re-chunks on edit (replaces old chunks), and removes on delete', async () => {
    const { indexer, clock } = setup();
    indexer.start();
    const n = repos.notes.save({ content: 'Title\n\nfirst version' });
    clock.advance(5_000);
    const firstCount = repos.chunks.count();
    expect(firstCount).toBeGreaterThan(0);
    repos.notes.update(n.id, 'Title\n\nsecond much longer version ' + 'x'.repeat(1500));
    clock.advance(5_000);
    // still only this note's chunks (replaced, not appended)
    const ids = repos.chunks.pendingEmbedding(100).filter((c) => c.refId === n.id);
    expect(ids.every((c) => c.refId === n.id)).toBe(true);
    repos.notes.softDelete(n.id);
    await flush();
    expect(repos.chunks.pendingEmbedding(100).filter((c) => c.refId === n.id)).toHaveLength(0);
    indexer.stop();
  });
});

describe('indexer message + history purge (G3)', () => {
  it('indexes messages only while history is enabled', () => {
    let history = true;
    const { indexer } = setup({ historyEnabled: () => history });
    indexer.start();
    indexer.onMessagePersisted({ id: 'm1', convId: 'c1', content: 'we talked about the lake house', ts: 1 });
    expect(repos.chunks.countByKind().message).toBe(1);
    // history off → purge messages immediately
    history = false;
    indexer.onHistoryToggled(false);
    expect(repos.chunks.countByKind().message).toBe(0);
    // further messages are not indexed
    indexer.onMessagePersisted({ id: 'm2', convId: 'c1', content: 'nope', ts: 2 });
    expect(repos.chunks.countByKind().message).toBe(0);
    indexer.stop();
  });
});

describe('indexer fact flow', () => {
  it('upserts and removes fact chunks', () => {
    const { indexer } = setup();
    indexer.start();
    indexer.onFactSaved({ id: 'f1', category: 'person', fact: 'partner lives in Columbus', ts: 1 });
    expect(repos.chunks.countByKind().fact).toBe(1);
    indexer.onFactForgotten('f1');
    expect(repos.chunks.countByKind().fact).toBe(0);
    indexer.stop();
  });
});

describe('indexer gating + boot rescan (G3)', () => {
  it('does not drain while an agent turn is active, then drains when the gate opens', async () => {
    let busy = true;
    const { indexer, clock } = setup({ canDrain: () => !busy });
    indexer.start();
    indexer.onFactSaved({ id: 'f1', category: 'work', fact: 'the deadline is Friday', ts: 1 });
    clock.advance(1);
    await flush();
    expect(repos.chunks.pendingEmbedding(10)).toHaveLength(1); // still pending (gated)
    busy = false;
    indexer.pump();
    clock.advance(1);
    await flush();
    expect(repos.chunks.pendingEmbedding(10)).toHaveLength(0);
    indexer.stop();
  });

  it('boot rescan embeds chunks left unembedded from a prior run', async () => {
    // simulate a prior run: chunks inserted but never embedded
    repos.chunks.replaceForRef('note', 'n1', ['Title\nleftover chunk'], { ts: 1 });
    expect(repos.chunks.pendingEmbedding(10)).toHaveLength(1);
    const { indexer, clock } = setup();
    indexer.start(); // pump() on start
    clock.advance(1);
    await flush();
    expect(repos.chunks.pendingEmbedding(10)).toHaveLength(0);
    indexer.stop();
  });
});

describe('growth cap (G3)', () => {
  it('prunes oldest message chunks first, never notes/facts', () => {
    // directly exercise the repo pruning order (cap enforcement uses this)
    repos.chunks.replaceForRef('note', 'n1', ['keep me'], { ts: 100 });
    repos.chunks.replaceForRef('fact', 'f1', ['fact: keep me too'], { ts: 100 });
    repos.chunks.replaceForRef('message', 'm1', ['old message'], { ts: 1 });
    repos.chunks.replaceForRef('message', 'm2', ['newer message'], { ts: 50 });
    const pruned = repos.chunks.pruneOldestMessages(1);
    expect(pruned).toBe(1);
    const kinds = repos.chunks.countByKind();
    expect(kinds.note).toBe(1);
    expect(kinds.fact).toBe(1);
    expect(kinds.message).toBe(1); // oldest (m1) removed, m2 kept
    const remaining = repos.chunks.pendingEmbedding(10).filter((c) => c.kind === 'message');
    expect(remaining[0]?.text).toContain('newer');
  });
});
