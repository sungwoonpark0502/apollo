import { describe, expect, it } from 'vitest';
import { type Embedder } from './embedder';
import { decideFactAction, matchFact, resolveForget } from './factMatch';

/** Stub embedder: maps known strings to controlled unit vectors so cosine is exact. */
function stubEmbedder(vectors: Record<string, [number, number, number]>): Embedder {
  const norm = (v: [number, number, number]): Float32Array => {
    const m = Math.hypot(...v) || 1;
    return Float32Array.from([v[0] / m, v[1] / m, v[2] / m]);
  };
  return {
    dim: 3,
    embed: (texts) => Promise.resolve(texts.map((t) => norm(vectors[t] ?? [1, 0, 0]))),
  };
}

describe('decideFactAction thresholds (G5)', () => {
  it('>0.90 updates, 0.75–0.90 replaces, below inserts', () => {
    expect(decideFactAction(0.95)).toBe('update');
    expect(decideFactAction(0.91)).toBe('update');
    expect(decideFactAction(0.9)).toBe('replace'); // boundary: not > 0.90
    expect(decideFactAction(0.85)).toBe('replace');
    expect(decideFactAction(0.75)).toBe('replace');
    expect(decideFactAction(0.74)).toBe('insert');
    expect(decideFactAction(0.5)).toBe('insert');
  });
});

describe('matchFact (G5)', () => {
  it('0.91-similar existing fact → update in place', async () => {
    // cos ~0.91 → small angle
    const emb = stubEmbedder({
      'partner lives in Columbus Ohio': [1, 0, 0],
      'partner lives in Columbus': [0.95, 0.312, 0], // cos = 0.95 > 0.9
    });
    const m = await matchFact(emb, 'partner lives in Columbus Ohio', [{ id: 'f1', fact: 'partner lives in Columbus' }]);
    expect(m.action).toBe('update');
    expect(m.target?.id).toBe('f1');
  });

  it('0.85-similar existing fact → replace', async () => {
    const emb = stubEmbedder({
      'works at Acme now': [1, 0, 0],
      'works at Globex': [0.82, 0.5724, 0], // cos ~0.82 in [0.75,0.9]
    });
    const m = await matchFact(emb, 'works at Acme now', [{ id: 'f1', fact: 'works at Globex' }]);
    expect(m.action).toBe('replace');
  });

  it('dissimilar fact → insert', async () => {
    const emb = stubEmbedder({
      'likes hiking': [1, 0, 0],
      'drives a Honda': [0, 1, 0], // orthogonal → cos 0
    });
    const m = await matchFact(emb, 'likes hiking', [{ id: 'f1', fact: 'drives a Honda' }]);
    expect(m.action).toBe('insert');
  });

  it('no candidates → insert', async () => {
    const emb = stubEmbedder({});
    expect((await matchFact(emb, 'anything', [])).action).toBe('insert');
  });
});

describe('resolveForget (G5)', () => {
  it('top-1 above 0.6 is the hit', async () => {
    const emb = stubEmbedder({
      'where partner lives': [1, 0, 0],
      'partner lives in Columbus': [0.9, 0.4359, 0], // cos 0.9 > 0.6
      'has a dog named Rex': [0, 1, 0],
    });
    const { hit, nearest } = await resolveForget(emb, 'where partner lives', [
      { id: 'f1', fact: 'partner lives in Columbus' },
      { id: 'f2', fact: 'has a dog named Rex' },
    ]);
    expect(hit?.id).toBe('f1');
    expect(nearest).toHaveLength(0);
  });

  it('below 0.6 → no hit, returns up to 3 nearest candidates', async () => {
    const emb = stubEmbedder({
      'my favourite colour': [1, 0, 0],
      'partner lives in Columbus': [0.3, 0.954, 0], // cos 0.3
      'has a dog named Rex': [0.2, 0.98, 0],
      'works at Acme': [0.1, 0.995, 0],
    });
    const { hit, nearest } = await resolveForget(emb, 'my favourite colour', [
      { id: 'f1', fact: 'partner lives in Columbus' },
      { id: 'f2', fact: 'has a dog named Rex' },
      { id: 'f3', fact: 'works at Acme' },
    ]);
    expect(hit).toBeNull();
    expect(nearest.length).toBeLessThanOrEqual(3);
    expect(nearest.length).toBeGreaterThan(0);
  });
});
