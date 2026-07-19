// Swaps better-sqlite3's native binary between the Node ABI (vitest) and the
// Electron ABI (pnpm dev). Builds are cached per runtime so a swap is a copy.
// Usage: node scripts/native-abi.mjs <node|electron>
//
// The binary on disk is the source of truth, never the marker file. A marker
// can go stale (a `pnpm install` replaces the package, a restored CI cache
// carries a binary built under a different Node), and trusting it caused two
// failure modes: locally, tests aborted with a hard NODE_MODULE_VERSION crash;
// in CI, a fresh checkout discarded the perfectly good binary `pnpm install`
// had just produced and tried to compile from source (which needs a toolchain
// the runner may not have). So: probe first, and only do work if the probe
// fails. A mismatched .node aborts the process rather than throwing, so the
// probe has to run in a child process.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const runtime = process.argv[2];
if (runtime !== 'node' && runtime !== 'electron') {
  console.error('usage: native-abi.mjs <node|electron>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('better-sqlite3/package.json'));
const binary = join(pkgDir, 'build/Release/better_sqlite3.node');
const cacheDir = join(pkgDir, '.abi-cache');
const marker = join(cacheDir, 'current');
mkdirSync(cacheDir, { recursive: true });

const electronVersion = require('electron/package.json').version;
const target = runtime === 'electron' ? electronVersion : process.versions.node;
const cached = join(cacheDir, `better_sqlite3-${runtime}-${target}.node`);
const want = `${runtime}-${target}`;

/**
 * Can the current binary actually be loaded by this Node? Run in a child
 * process: an ABI mismatch aborts the process, it does not throw.
 * Only meaningful for the node runtime — an Electron-ABI binary is expected
 * to fail here, which is exactly what we use it for.
 */
function loadsUnderNode() {
  if (!existsSync(binary)) return false;
  const probe = 'const D = require(process.argv[1]); new D(":memory:").close();';
  const r = spawnSync(process.execPath, ['-e', probe, pkgDir], { stdio: 'ignore' });
  return r.status === 0;
}

function markDone(how) {
  writeFileSync(marker, want);
  console.log(`native-abi: ${how} ${want}`);
  process.exit(0);
}

// Fast path: the installed binary already works for this runtime. This is the
// normal CI case right after `pnpm install`, and it needs no network and no
// compiler.
if (runtime === 'node' && loadsUnderNode()) {
  // Keep a copy so a later electron→node swap is a plain file copy.
  if (!existsSync(cached)) copyFileSync(binary, cached);
  markDone('verified');
}

// Cached build for this exact runtime+version: copy it in, then verify.
if (existsSync(cached)) {
  copyFileSync(cached, binary);
  if (runtime === 'electron' || loadsUnderNode()) markDone('restored');
  console.log('native-abi: cached binary did not load; rebuilding');
}

console.log(`native-abi: fetching prebuild for ${want}…`);
const install = spawnSync('pnpm', ['exec', 'prebuild-install', '-r', runtime, '-t', target], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: false,
});

if (install.status !== 0) {
  console.log('native-abi: prebuild-install failed, building from source…');
  const env = { ...process.env };
  if (runtime === 'electron') {
    env.npm_config_runtime = 'electron';
    env.npm_config_target = target;
    env.npm_config_disturl = 'https://electronjs.org/headers';
  }
  const build = spawnSync('pnpm', ['exec', 'node-gyp', 'rebuild', `--target=${target}`], {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: false,
    env,
  });
  if (build.status !== 0) {
    console.error(
      `native-abi: could not obtain a ${want} binary. A source build needs Python 3 and a C++ toolchain ` +
        '(Xcode CLT on macOS, MSVC Build Tools on Windows).',
    );
    process.exit(1);
  }
}

copyFileSync(binary, cached);
markDone('built');
