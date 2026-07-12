// Swaps better-sqlite3's native binary between the Node ABI (vitest) and the
// Electron ABI (pnpm dev). Builds are cached per runtime so a swap is a copy.
// Usage: node scripts/native-abi.mjs <node|electron>
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const current = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
const want = `${runtime}-${target}`;
if (current === want && existsSync(binary)) {
  console.log(`native-abi: already ${want}`);
  process.exit(0);
}

if (!existsSync(cached)) {
  if (existsSync(binary) && current && !existsSync(join(cacheDir, `better_sqlite3-${current}.node`))) {
    copyFileSync(binary, join(cacheDir, `better_sqlite3-${current}.node`));
  }
  const args = ['exec', 'prebuild-install', '-r', runtime, '-t', target];
  console.log(`native-abi: fetching prebuild for ${want}…`);
  const r = spawnSync('pnpm', args, { cwd: pkgDir, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.log('native-abi: prebuild-install failed, building from source…');
    const env = { ...process.env };
    if (runtime === 'electron') {
      env.npm_config_runtime = 'electron';
      env.npm_config_target = target;
      env.npm_config_disturl = 'https://electronjs.org/headers';
    }
    const b = spawnSync('pnpm', ['exec', 'node-gyp', 'rebuild', `--target=${target}`], {
      cwd: pkgDir,
      stdio: 'inherit',
      shell: false,
      env,
    });
    if (b.status !== 0) {
      console.error('native-abi: build failed');
      process.exit(1);
    }
  }
  copyFileSync(binary, cached);
} else {
  copyFileSync(cached, binary);
}
writeFileSync(marker, want);
console.log(`native-abi: now ${want}`);
