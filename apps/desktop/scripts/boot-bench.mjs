// H8 boot budget harness: launches the app N times in smoke mode, parses the
// boot_to_tray span from the SMOKE_OK marker, and asserts p95 < 2500ms.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RUNS = Number(process.env.BOOT_BENCH_RUNS ?? 5);
const BUDGET_MS = 2500;
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function oneRun() {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env, APOLLO_SMOKE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn('pnpm', ['exec', 'electron-vite', 'dev'], { cwd: desktopDir, env });
    let out = '';
    const onData = (b) => {
      out += b.toString();
      const m = out.match(/boot_to_tray=(\d+)/);
      if (m) {
        child.kill();
        resolvePromise(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => {
      const m = out.match(/boot_to_tray=(\d+)/);
      if (m) resolvePromise(Number(m[1]));
      else reject(new Error(`no boot_to_tray marker in run output:\n${out.slice(-400)}`));
    });
  });
}

const samples = [];
for (let i = 0; i < RUNS; i++) {
  const ms = await oneRun();
  samples.push(ms);
  console.log(`run ${i + 1}: boot_to_tray=${ms}ms`);
}
samples.sort((a, b) => a - b);
const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
const median = samples[Math.floor(samples.length / 2)];
console.log(`\nboot_to_tray median=${median}ms p95=${p95}ms budget=${BUDGET_MS}ms`);
if (p95 > BUDGET_MS) {
  console.error(`FAIL: p95 ${p95}ms exceeds ${BUDGET_MS}ms`);
  process.exit(1);
}
console.log('PASS');
