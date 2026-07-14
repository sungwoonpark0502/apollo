/**
 * G1: fetches the embedding model at BUILD time only. Downloads
 * Xenova/all-MiniLM-L6-v2 (quantized) into resources/models/minilm/ and prints
 * the SHA-256 of each file to record in DECISIONS.md. The app never downloads at
 * runtime; if this cannot run (offline), the instructions land in HUMAN_TODO.md
 * and the app falls back to FakeEmbedder (A2).
 *
 * Usage: pnpm --filter @apollo/desktop fetch-models
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HF_BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
// The minimal file set transformers.js needs for feature-extraction (quantized ONNX).
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

const modelsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'models', 'minilm');

async function main(): Promise<void> {
  mkdirSync(join(modelsDir, 'onnx'), { recursive: true });
  const hashes: Record<string, string> = {};
  for (const file of FILES) {
    const dest = join(modelsDir, file);
    if (existsSync(dest)) {
      hashes[file] = sha256(readFileSync(dest));
      console.log(`exists  ${file}  sha256=${hashes[file]}`);
      continue;
    }
    const url = `${HF_BASE}/${file}`;
    console.log(`fetch   ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    hashes[file] = sha256(buf);
    console.log(`saved   ${file}  (${buf.length} bytes)  sha256=${hashes[file]}`);
  }
  console.log('\nRecord these SHA-256 hashes in DECISIONS.md:');
  for (const [f, h] of Object.entries(hashes)) console.log(`  ${f}: ${h}`);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

main().catch((e: unknown) => {
  console.error(`fetch-models failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('Follow HUMAN_TODO.md to download the model manually; the app runs on FakeEmbedder until then.');
  process.exit(1);
});
