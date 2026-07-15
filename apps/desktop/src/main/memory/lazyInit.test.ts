import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmbedder } from './embedderFactory';
import { createRealEmbedder } from './embedder';
import { defaultSettings } from '@apollo/shared';

/**
 * H8 lazy initialization proofs. The embedder must not load model files at
 * construction — only on the first embed() call.
 */
describe('lazy init: embedder (H8)', () => {
  it('createRealEmbedder does NOT touch the model at construction (only on embed)', async () => {
    // Constructing against a non-existent model dir must not throw; the failure
    // only surfaces when embed() is actually called (proving lazy load).
    const e = createRealEmbedder({ modelDir: '/definitely/not/a/real/model/dir' });
    expect(e.dim).toBe(384);
    await expect(e.embed(['hello'])).rejects.toBeTruthy(); // load attempted lazily, and fails
  });

  it('embedderFactory picks fake when no model is present, without loading transformers', () => {
    const modelDir = '/definitely/not/a/real/model/dir';
    expect(existsSync(`${modelDir}/minilm/onnx/model_quantized.onnx`)).toBe(false);
    const { adapterState } = createEmbedder({ settings: () => defaultSettings(), modelDir });
    expect(adapterState).toBe('fake');
  });
});

