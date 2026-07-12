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
        input: { index: resolve(__dirname, 'src/main/index.ts') },
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
          palette: resolve(__dirname, 'src/renderer/windows/palette/index.html'),
          settings: resolve(__dirname, 'src/renderer/windows/settings/index.html'),
        },
      },
    },
  },
});
