// Rebuild native modules for Electron when both electron-builder and a native
// dep are present; a plain exit otherwise keeps first install bootstrappable.
import { spawnSync } from 'node:child_process';

function has(mod) {
  try {
    import.meta.resolve(`${mod}/package.json`);
    return true;
  } catch {
    return false;
  }
}

if (!has('electron-builder') || !has('better-sqlite3')) {
  console.log('postinstall: skipping install-app-deps (toolchain or native deps not present yet)');
  process.exit(0);
}

const r = spawnSync('pnpm', ['exec', 'electron-builder', 'install-app-deps'], {
  stdio: 'inherit',
  shell: false,
});
if (r.status !== 0) {
  // Dev/test ABI is managed by scripts/native-abi.mjs; packaging reruns this.
  console.warn('postinstall: install-app-deps failed; continuing (native ABI handled per-task)');
}
process.exit(0);
