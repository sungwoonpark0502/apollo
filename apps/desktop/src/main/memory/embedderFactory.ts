import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Settings } from '@apollo/shared';
import { createRealEmbedder, FakeEmbedder, type Embedder } from './embedder';

/**
 * G1 adapter selection: real MiniLM when adapters.embedder is 'real', or 'auto'
 * and the model files exist on disk; FakeEmbedder otherwise (CI/dev). Never
 * downloads.
 */
export function createEmbedder(deps: { settings: () => Settings; modelDir: string; log?: (msg: string) => void }): {
  embedder: Embedder;
  adapterState: 'minilm' | 'fake';
} {
  const mode = deps.settings().adapters.embedder;
  const modelPresent = existsSync(join(deps.modelDir, 'minilm', 'onnx', 'model_quantized.onnx'));
  const useReal = mode === 'real' || (mode === 'auto' && modelPresent);
  if (useReal) {
    return { embedder: createRealEmbedder({ modelDir: deps.modelDir, log: deps.log }), adapterState: 'minilm' };
  }
  return { embedder: new FakeEmbedder(), adapterState: 'fake' };
}
