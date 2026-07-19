import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Fixed, distinct port: the DESKTOP dev server owns 5173, and its root path
  // 404s (pages live under /windows/...) — exactly the confusing page a user
  // hits if the web client silently hops ports after a collision. strictPort
  // makes a collision loud instead.
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  // The backend origin is baked at build time; dev points at a local backend.
  define: {
    __APOLLO_BACKEND__: JSON.stringify(process.env['APOLLO_BACKEND_URL'] ?? 'http://localhost:8787'),
  },
});
