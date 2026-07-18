import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@apollo/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  test: { environment: 'node' },
});
