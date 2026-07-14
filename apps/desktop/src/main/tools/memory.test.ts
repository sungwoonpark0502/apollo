import { beforeEach, describe, expect, it } from 'vitest';
import { type ToolCtx } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createMemoryTools } from './memory';
import { type Embedder } from '../memory/embedder';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

/** Controlled embedder keyed by fact text. */
function stub(vectors: Record<string, [number, number, number]>): Embedder {
  const norm = (v: [number, number, number]): Float32Array => {
    const m = Math.hypot(...v) || 1;
    return Float32Array.from([v[0] / m, v[1] / m, v[2] / m]);
  };
  return { dim: 3, embed: (texts) => Promise.resolve(texts.map((t) => norm(vectors[t] ?? [0, 0, 1]))) };
}

const ctx = { convId: 'c1', turnId: 't1' } as ToolCtx;
function tools(embedder: Embedder) {
  const [save, forget] = createMemoryTools({ memory: repos.memory, undo: repos.undo, embedder });
  return { save: save!, forget: forget! };
}

describe('memory.save dedupe/replace (G5)', () => {
  it('updates a near-duplicate in place (same row id, new text)', async () => {
    const first = repos.memory.save({ category: 'person', fact: 'partner lives in Columbus' });
    const { save } = tools(
      stub({ 'partner lives in Columbus': [1, 0, 0], 'partner lives in Columbus, Ohio': [0.96, 0.28, 0] }),
    );
    const res = await save.execute({ category: 'person', fact: 'partner lives in Columbus, Ohio' }, ctx);
    expect(res.llmText).toContain('Updated what I knew');
    const live = repos.memory.list();
    expect(live).toHaveLength(1); // no new row
    expect(live[0]!.id).toBe(first.id);
    expect(live[0]!.fact).toBe('partner lives in Columbus, Ohio');
  });

  it('replaces a contradicting fact (soft-delete old, insert new)', async () => {
    repos.memory.save({ category: 'work', fact: 'works at Globex' });
    const { save } = tools(stub({ 'works at Globex': [1, 0, 0], 'works at Acme': [0.82, 0.5724, 0] }));
    const res = await save.execute({ category: 'work', fact: 'works at Acme' }, ctx);
    expect(res.llmText).toContain('Replaced');
    const live = repos.memory.list();
    expect(live).toHaveLength(1);
    expect(live[0]!.fact).toBe('works at Acme');
  });

  it('inserts an unrelated fact as new', async () => {
    repos.memory.save({ category: 'person', fact: 'partner lives in Columbus' });
    const { save } = tools(stub({ 'partner lives in Columbus': [1, 0, 0], 'allergic to peanuts': [0, 1, 0] }));
    const res = await save.execute({ category: 'person', fact: 'allergic to peanuts' }, ctx);
    expect(res.llmText).toContain('Remembered');
    expect(repos.memory.list()).toHaveLength(2);
  });

  it('only compares within the same category', async () => {
    repos.memory.save({ category: 'work', fact: 'works at Globex' });
    // identical-ish vector but different category → must insert, not update
    const { save } = tools(stub({ 'works at Globex': [1, 0, 0], 'lives near Globex tower': [1, 0, 0] }));
    await save.execute({ category: 'place', fact: 'lives near Globex tower' }, ctx);
    expect(repos.memory.list()).toHaveLength(2);
  });
});

describe('memory.forget by similarity (G5)', () => {
  it('forgets the closest fact when above threshold', async () => {
    repos.memory.save({ category: 'person', fact: 'partner lives in Columbus' });
    repos.memory.save({ category: 'person', fact: 'has a dog named Rex' });
    const { forget } = tools(
      stub({
        'where my partner lives': [1, 0, 0],
        'partner lives in Columbus': [0.9, 0.4359, 0],
        'has a dog named Rex': [0, 1, 0],
      }),
    );
    const res = await forget.execute({ fact: 'where my partner lives' }, ctx);
    expect(res.llmText).toContain('Forgot');
    expect(repos.memory.list().map((f) => f.fact)).toEqual(['has a dog named Rex']);
  });

  it('lists nearest candidates and does nothing when below threshold', async () => {
    repos.memory.save({ category: 'person', fact: 'partner lives in Columbus' });
    repos.memory.save({ category: 'person', fact: 'has a dog named Rex' });
    const { forget } = tools(
      stub({
        'my favourite colour': [1, 0, 0],
        'partner lives in Columbus': [0.3, 0.954, 0],
        'has a dog named Rex': [0.2, 0.98, 0],
      }),
    );
    const res = await forget.execute({ fact: 'my favourite colour' }, ctx);
    expect(res.llmText).toContain('no clear match');
    expect(res.undoToken).toBeUndefined();
    expect(repos.memory.list()).toHaveLength(2); // nothing deleted
  });
});
