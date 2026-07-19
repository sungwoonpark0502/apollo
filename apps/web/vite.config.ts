import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The backend origin is baked at build time; dev points at a local backend.
  define: {
    __APOLLO_BACKEND__: JSON.stringify(process.env['APOLLO_BACKEND_URL'] ?? 'http://localhost:8787'),
  },
});
