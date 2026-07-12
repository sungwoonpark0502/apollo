import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@apollo/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron'],
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
        external: ['electron'],
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
        },
      },
    },
  },
});
