# DECISIONS

- 2026-07-12: Node 22.14.0 (current machine LTS) instead of Node 20; engines set to >=20 so both work. Reason: installed toolchain, both are LTS.
- 2026-07-12: Tray icon generated deterministically by scripts/gen-assets.mjs (pure-Node PNG writer) instead of committing binary blobs. Reason: reviewable, reproducible resources.
- 2026-07-12: macOS dock hidden (tray-only app). Reason: B2 "quiet" invariant; palette/orb are the only surfaces.
- 2026-07-12: APOLLO_SMOKE=1 dev flag prints SMOKE_OK and exits after tray+palette creation. Reason: A2 self-verification of "pnpm dev opens tray + palette" without human eyes.
- 2026-07-12: .npmrc node-linker=hoisted for electron-vite/electron-builder compatibility under pnpm. Reason: native module packaging.
- 2026-07-12: Exact versions installed (C1 "latest stable"): electron 43.1.0, electron-vite 5.0.0, electron-builder 26.15.3, react/react-dom 19.2.7, typescript 5.9.x, vitest 4.1.10, eslint 10.7.0, prettier 3.9.5, @types/node 26.1.1.
- 2026-07-12: React 19 instead of C1's known-good major 18. Reason: C1 says install latest stable; 19 is latest and createRoot API is unchanged.
- 2026-07-12: TypeScript pinned to ^5 (not 7.x native): typescript-eslint and electron-vite do not support the TS7 Go-based API yet.
- 2026-07-12: `electron` marked explicitly external in electron-vite main/preload rollupOptions; electron-vite 5 (rolldown) inlined the npm shim otherwise.
- 2026-07-12: Dev runs must unset ELECTRON_RUN_AS_NODE (set by some agent/CI shells); documented in README later.
