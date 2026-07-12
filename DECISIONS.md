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
- 2026-07-12: better-sqlite3 12.11.1 instead of C1's major 11: v11 does not compile against Electron 43's V8. v12 builds from source for Electron (no arm64 prebuild published).
- 2026-07-12: scripts/native-abi.mjs caches and swaps the better-sqlite3 binary between Node ABI (pretest) and Electron ABI (predev); electron-builder install-app-deps still runs at package time.
- 2026-07-12: Migration SQL files bundled via vite `?raw` imports so packaged main needs no loose .sql files; files remain the source of truth in db/migrations/.
- 2026-07-12: C11 weekday rows: the table's example values win over its prose ("this Friday"→07-17, "next Friday"→07-24 from Sat 07-11). Implemented as: bare/"this" weekday = upcoming occurrence; "next" = upcoming + 7 days.
- 2026-07-12: fastPath "open X" accepts any name and full-matches; the openApp tool's allowlist rejects non-apps (keeps grammar simple, no dead end).
- 2026-07-12: httpClient maps 401/403→KEY_INVALID, 429→RATE_LIMITED, network exhaustion→OFFLINE; egress requires https and exact hostname match.
