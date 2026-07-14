/**
 * G1 embedding adapter. Everything runs on-device; the real adapter loads model
 * files from disk only (never downloads at runtime). FakeEmbedder gives
 * deterministic seeded-hash vectors so all pipeline/ranking tests run with zero
 * model files.
 */
export interface Embedder {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const EMBED_DIM = 384; // Xenova/all-MiniLM-L6-v2

function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

/** Deterministic FNV-1a-seeded pseudo-embedding: same text → same vector, L2-normalized. */
export class FakeEmbedder implements Embedder {
  readonly dim = EMBED_DIM;

  embed(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => {
      const v = new Float32Array(this.dim);
      for (let d = 0; d < this.dim; d++) {
        // hash(text + ':' + d) → a value in [-1, 1)
        let h = 2166136261 ^ d;
        for (let i = 0; i < t.length; i++) {
          h ^= t.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        v[d] = ((h >>> 0) / 0xffffffff) * 2 - 1;
      }
      return l2normalize(v);
    }));
  }
}

export interface RealEmbedderDeps {
  modelDir: string; // resources/models (contains minilm/)
  modelName?: string; // default 'minilm'
  log?: (msg: string) => void;
}

/**
 * MiniLM via transformers.js: batch 8, mean pooling, L2-normalized. Configured
 * to load from local disk only — env.allowRemoteModels is forced off so a
 * missing model raises rather than triggering a runtime download (G1 constraint).
 */
export function createRealEmbedder(deps: RealEmbedderDeps): Embedder {
  const modelName = deps.modelName ?? 'minilm';
  let extractorP: Promise<(texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>> | null = null;

  async function extractor(): Promise<(texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>> {
    if (!extractorP) {
      extractorP = (async () => {
        const tf = (await import('@huggingface/transformers')) as unknown as {
          env: { allowRemoteModels: boolean; allowLocalModels: boolean; localModelPath: string };
          pipeline: (task: string, model: string, opts: { dtype: string }) => Promise<(texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>>;
        };
        tf.env.allowRemoteModels = false; // never download at runtime (G1)
        tf.env.allowLocalModels = true;
        tf.env.localModelPath = deps.modelDir;
        deps.log?.(`loading embedder from ${deps.modelDir}/${modelName}`);
        return tf.pipeline('feature-extraction', modelName, { dtype: 'q8' }); // → onnx/model_quantized.onnx
      })();
    }
    return extractorP;
  }

  return {
    dim: EMBED_DIM,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const run = await extractor();
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 8) {
        const batch = texts.slice(i, i + 8);
        const res = await run(batch, { pooling: 'mean', normalize: true });
        for (const row of res.tolist()) out.push(l2normalize(Float32Array.from(row)));
      }
      return out;
    },
  };
}

/** Cosine similarity of two L2-normalized vectors (dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
