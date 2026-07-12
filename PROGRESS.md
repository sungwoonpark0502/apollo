# PROGRESS

## Phase 0

### [x] 0.4 Registry + tools + fastPath + timeResolver — verified: 110 desktop tests green (32 resolver golden rows, 12 fastPath, registry timeout/validation/error, tool suites vs in-memory DB, breaker transitions, egress allow/deny, weather cache, brave KEY_MISSING path)
Planned files:
- apps/desktop/src/main/agent/{timeResolver.ts, timeResolver.test.ts, fastPath.ts, fastPath.test.ts}
- apps/desktop/src/main/net/{egress.ts, breaker.ts, httpClient.ts, net.test.ts}
- apps/desktop/src/main/tools/{registry.ts, timer.ts, alarm.ts, note.ts, todo.ts, contact.ts, memory.ts, weather.ts, searchWeb.ts, undo.ts}
- apps/desktop/src/main/tools/{registry.test.ts, tools.test.ts, weather.test.ts}
Verify: resolver golden table (25+), fastPath full-match vs residue, registry timeout/validation/error wrap, tool suites, breaker transitions, egress allow/deny.

### [x] 0.3 DB layer — verified: 23 repo tests green incl. DST wall-time golden case, exdates, FTS sync, undo LIFO, snooze lifecycle; migrations idempotent on :memory:
Planned files:
- apps/desktop/src/main/db/{connection.ts, migrate.ts}
- apps/desktop/src/main/db/migrations/0001_init.sql (verbatim C6)
- apps/desktop/src/main/db/repos/{events,reminders,timers,alarms,notes,todos,contacts,conversations,memory,capabilityMisses,feeds,perf,undo,settings}.ts (+ index.ts)
- apps/desktop/src/main/db/repos.test.ts (incl. rrule DST expansion golden case)
- apps/desktop/scripts/native-abi.mjs (swaps better-sqlite3 prebuild between node/electron ABI for tests vs dev)
- packages/shared/src/cards.ts: add OccurrenceDTO
Verify: repo test suite green including DST case; in-memory mode used by tests.

### [x] 0.2 packages/shared complete + ipc router + preload — verified: 54 tests green (round-trips all 13 invoke + 5 push channels, malformed rejection, spoofed-frame drop); smoke boot OK
Note: router registration wiring into main happens in 0.6 when the first real handlers (settings/keys) exist.
Planned files:
- packages/shared/src/{ids,time,errors,strings,cards,agent,voice,ipc,settings,index}.ts
- packages/shared/src/{ipc.test.ts,cards.test.ts}
- apps/desktop/src/main/ipc/router.ts (+ router.test.ts)
- apps/desktop/src/preload/index.ts (typed bridge from channel table)
Verify: round-trip tests for every channel schema; malformed payload rejection; spoofed-frame drop test.

### [x] 0.1 Monorepo scaffold, electron-vite boot, tray, empty palette — verified: typecheck+lint green; `APOLLO_SMOKE=1 pnpm dev` printed `SMOKE_OK tray=true palette=true`
Planned files:
- pnpm-workspace.yaml, package.json, .npmrc, .gitignore, .env.example, tsconfig.base.json
- .github/workflows/ci.yml (minimal; expanded in later milestones)
- packages/shared/{package.json, tsconfig.json, src/index.ts} (placeholder; full contracts in 0.2)
- apps/desktop/{package.json, tsconfig.json, electron.vite.config.ts}
- apps/desktop/scripts/gen-assets.mjs (generates tray icon PNG deterministically)
- apps/desktop/src/main/{index.ts, windows.ts, tray.ts}
- apps/desktop/src/preload/index.ts
- apps/desktop/src/renderer/windows/palette/{index.html, main.tsx, App.tsx}
- apps/desktop/src/renderer/styles/tokens.css
Verify: `pnpm i && pnpm -r typecheck && pnpm dev` opens tray + palette (smoke-verified via APOLLO_SMOKE=1 marker).
