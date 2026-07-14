import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cosine, createRealEmbedder, EMBED_DIM, FakeEmbedder } from './embedder';

describe('FakeEmbedder (G1)', () => {
  it('produces deterministic, L2-normalized, correct-dim vectors', async () => {
    const e = new FakeEmbedder();
    expect(e.dim).toBe(EMBED_DIM);
    const [a] = await e.embed(['hello world']);
    expect(a).toHaveLength(EMBED_DIM);
    // L2 norm == 1
    expect(cosine(a!, a!)).toBeCloseTo(1, 5);
    // determinism
    const [a2] = await e.embed(['hello world']);
    expect(Array.from(a2!)).toEqual(Array.from(a!));
  });

  it('different texts get different vectors', async () => {
    const e = new FakeEmbedder();
    const [a, b] = await e.embed(['cat', 'dog']);
    expect(cosine(a!, b!)).toBeLessThan(0.999);
  });

  it('empty input returns empty', async () => {
    expect(await new FakeEmbedder().embed([])).toEqual([]);
  });

  it('cosine of orthogonal-ish vectors is bounded in [-1,1]', async () => {
    const e = new FakeEmbedder();
    const v = await e.embed(['alpha', 'beta', 'gamma']);
    for (let i = 0; i < v.length; i++)
      for (let j = 0; j < v.length; j++) {
        const c = cosine(v[i]!, v[j]!);
        expect(c).toBeGreaterThanOrEqual(-1.001);
        expect(c).toBeLessThanOrEqual(1.001);
      }
  });
});

// Real-model smoke: runs only when the build-time model files are present; CI
// without model files skips it (the constraint that tests need no model files).
const modelDir = join(__dirname, '../../../resources/models');
const hasModel = existsSync(join(modelDir, 'minilm', 'onnx', 'model_quantized.onnx'));
describe.runIf(hasModel)('real embedder (on-device, model present)', () => {
  it('loads from disk and gives semantically meaningful similarity', async () => {
    const e = createRealEmbedder({ modelDir });
    const [dentist, dental, quantum] = await e.embed([
      'the dentist appointment is next Tuesday',
      'when is my dental visit',
      'quantum chromodynamics lecture notes',
    ]);
    expect(dentist).toHaveLength(EMBED_DIM);
    expect(cosine(dentist!, dental!)).toBeGreaterThan(cosine(dentist!, quantum!));
  }, 60_000);
});
