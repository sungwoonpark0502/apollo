import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
const runtimeDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@apollo/shared');
const nodeExternals = ['electron', /^node:/, ...runtimeDeps];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@apollo/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          audioWorker: resolve(__dirname, 'src/audio-worker/index.ts'),
        },
        external: nodeExternals,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@apollo/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'], // preload stays bundled (sandbox can't require node_modules)
        output: { format: 'cjs', entryFileNames: '[name].js' }, // sandboxed preloads must be CJS
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { '@apollo/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: {
        input: {
          settings: resolve(__dirname, 'src/renderer/windows/settings/index.html'),
          orb: resolve(__dirname, 'src/renderer/windows/orb/index.html'),
          audio: resolve(__dirname, 'src/renderer/windows/audio/index.html'),
          onboarding: resolve(__dirname, 'src/renderer/windows/onboarding/index.html'),
          workspace: resolve(__dirname, 'src/renderer/windows/workspace/index.html'),
          capture: resolve(__dirname, 'src/renderer/windows/capture/index.html'),
        },
      },
    },
  },
});
