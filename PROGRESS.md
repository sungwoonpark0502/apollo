# PROGRESS

## Phase 3

### [x] 3.2 draft/send + ConfirmCard + 5s cancel + taint UI — verified: email.draft/send tools (3.1); ConfirmCard renders args table with taintFlags in --danger (0.6); orchestrator emits cancelWindow(5000ms) on email.send approval and aborts on agent.cancel during the grace window (orchestrator suite: suspend-without-execute, approve-executes, cancel-during-window-aborts, supersede, expire); new CancelWindowBar (shrinking bar + Cancel) wired into palette (store cancelWindow state) and orb (local state), Cancel → agent.cancel(turnId); DraftCard Send routes through the confirm flow. 318 tests green.

### [x] 3.1 OAuth + provider + list/read/search + sanitizer + Email cards — verified: sanitizer suite (7 tests: strips script/style/iframe/form/handlers, blocks+counts remote images, neutralizes javascript:/data: hrefs, plaintext extraction, hidden white-text inert); email tools suite (9 tests: untrusted <data> wrapping, sanitized read, KEY_MISSING on disconnect, draft-no-send, send, recipient rule w/ contact+utterance clearing); OAuth PKCE suite (4 tests: S256 challenge, loopback code exchange, state-mismatch CSRF guard, refresh); Gmail provider (googleapis, readonly+send scopes, MIME body extraction); EmailList/Detail(sandboxed iframe, Load-images)/Draft cards; Accounts tab; C13 recipient taint rule enforced in orchestrator gate even when untainted (contact-email resolution clears it). Real Gmail needs a Google OAuth client (HUMAN_TODO). 318 tests green.

## Phase 2

### [x] Phase 2 GATE — verified: FSM suite green on fakes (14 tests); perf harness green (C21.4: 20 end-to-end FakeSTT-driven turns, pipeline overhead p95 ~6ms << 250ms; chunker first-flush p95 << 50ms); live-audio checklist (wake, barge-in under music, no self-trigger, mute, PTT) written to HUMAN_TODO as the only remaining physical-mic items. Full suite: 298 tests, lint + typecheck clean.

### [x] 2.4 Porcupine adapter + sensitivity + Diagnostics dashboard — verified: porcupine adapter suite (5 tests: dual normal/gated engines at sensitivity−0.15, gated-frame routing, setSensitivity rebuild+release, stop, 512-frame contract) with native module mocked so no Picovoice key needed in CI; sensitivity slider in Voice tab → settings.set → workerHost.send({t:setSensitivity}); Diagnostics tab renders perf p50/p95 table, adapter states, 200-line log tail with Copy button via new diagnostics.get channel; smoke green. Constructing the real engine needs a Picovoice account key (HUMAN_TODO).

### [x] 2.3 Chunker + edge TTS + FakeTTS + orb playback + barge-in + gating + earcons + waveform + captions — verified: chunker suite (8 tests incl. C21 abbreviation/decimal paragraph, 220-char force-flush, <50ms first flush); pipeline suite (13 tests: sequenced audio w/ last marker, barge-in synchronous flush via generation guard, one-time TTS_DOWN degrade, text-only guard, TTS→STT overlap>=90% round-trip per A2.2b on fakes); edge-tts adapter produces real mp3 (probed: 25 chunks / 17KB, keyless); earcons generated deterministically (wake=two rising notes 120ms, done, error); orb renders 24-bar rms waveform + live caption strip + gated playback; smoke green

### [x] 2.2 Deepgram adapter + FakeSTT + VoiceController FSM — verified: 14-test FSM suite covering every C12.3 row (wake/hotkey entry, partial+rms, endpoint EOT, VAD-600ms EOT first-wins, 4s no-speech idle, 30s cap, thinking→speaking gating, barge-in with STT reopen, drain→idle, mute/unmute, empty-transcript idle, 2-failure STT_DOWN degrade); Deepgram live adapter (keepalive 8s, one reconnect w/ buffered frames); debug.injectAudio drives wake→listen→EOT from a WAV; smoke green

### [x] 2.1 Audio capture + worker + Silero VAD + FakeWake — verified: 10-test audio suite (VAD hangover mechanics, real Silero onnx inference, worker mode machine passive/stream/gated/mute, WAV parse/frame/stereo-downmix for debug.injectAudio); smoke shows "audio worker ready" in the utilityProcess; crash backoff 1s/5s/15s then voice-disabled notification. PTT design: hotkey press = wake-free listening entry (Electron global shortcuts cannot observe key-up; recorded in DECISIONS).

## Phase 1

### Phase 1 GATE — recurrence goldens ✓ (repo + calendar suites); missed-reminder-on-boot ✓ (reminder.test GATE case); orb click-through ✓ (smoke: clickThroughIdle=true interactiveActive=true); eval extended to 81 rows ✓ seeded (≥90% real-model run pending key, HUMAN_TODO; harness machinery re-verified). GREEN-WITH-MOCK per A2.4.

### [x] 1.5 Orb shell with text-triggered states + panel + pinning — verified via smoke: orb alwaysOnTop, unfocused, click-through idle, interactive during turns; 8s auto-dismiss + pin in renderer
Planned files:
- apps/desktop/src/main/windows.ts: createOrbWindow (click-through idle, activity toggling, per-display position)
- apps/desktop/src/main/orbController.ts: idle/active + setIgnoreMouseEvents driving from agent events
- apps/desktop/src/renderer/windows/orb/{index.html, main.tsx, OrbApp.tsx}
- electron.vite.config.ts: orb input; index.ts wiring; smoke check extended (orb + click-through flag)
Verify: click-through verified programmatically in smoke; states flip on turnStart/done; cards auto-dismiss after 8s unless pinned/hovered.

### [x] 1.4 files.find + system tools + allowlist scan — verified: 17-test suite (approved-dir confinement, extension filter, .app scan + fuzzy rank, closest-candidates fallback, fixed spawn templates with validated integers, schema rejection before spawn, CGSession lock, screenshot path)

### [x] 1.3 news.brief + feeds settings — verified: 12-test suite (dedupe by canonical URL, top-8 recency, category filter, per-feed WARNING degradation, one summarize call + snippet fallback); default feeds seeded at boot; feeds synced through settings.get/set

### [x] 1.2 Reminders + scheduler + boot catch-up + missed grouping
Planned files:
- apps/desktop/src/main/tools/reminder.ts (+ reminder.test.ts)
- apps/desktop/src/main/scheduler/scheduler.ts: rrule re-arm for recurring reminders/alarms (+ tests)
- index.ts wiring (reminder tools + rearm hooks); eval catalog real reminder defs
Verify: missed-reminder-on-boot test (gate), recurring re-arm across DST, reminder tool suite.

### [x] 1.1 Calendar complete + cards — verified: 18-test suite (tz, overlap/past warnings, 20-occurrence cap, scope single via exdate+detached with undo, scope all with revert undo); Event/EventList cards wired; eval catalog uses real calendar defs
Planned files:
- apps/desktop/src/main/tools/calendar.ts (+ calendar.test.ts): create/update/delete (scope single|all via exdates + detached events)/list (max 20 occurrences)/search
- apps/desktop/src/renderer/components/cards/{EventCard,EventListCard}.tsx; CardView wiring
- eval/toolCatalog.ts: calendar stubs replaced by real defs
Verify: calendar tool suite incl. recurrence scope edits, tz, past/overlap warnings.

## Phase 0

### [x] 0.7 Real LLM + eval harness — GREEN-WITH-MOCK (A2.4): Anthropic streaming adapter wired (egress-checked fetch); scheduler test proves timer fires after restart; dead-end gate covered by 0.5 test + eval rows; eval harness (50 rows) machinery self-verified via LLM-free row; real-model run requires ANTHROPIC_API_KEY → exact step in HUMAN_TODO; runner reports SKIPPED per C22 meanwhile
Planned files:
- apps/desktop/src/main/agent/llmAnthropic.ts (streaming adapter, egress-checked fetch)
- apps/desktop/src/main/scheduler/scheduler.ts (+ test) — minimal timer arm/fire/catch-up for the restart gate; extended in 1.2
- apps/desktop/src/main/index.ts: use Anthropic adapter when key exists; wire scheduler + OS notification
- eval/golden.jsonl (50+ rows), eval/toolCatalog.ts (real registry + mocked executors + future-tool stubs), eval/run.ts, root script `pnpm eval`
Gate: eval >= 90% with real key (no key on this machine → runner prints SKIPPED per C22, item goes to HUMAN_TODO, milestone green-with-mock per A2.4); timer fires after restart (scheduler test); unsupported request → alternative + capability_misses (0.5 test + eval rows).

### [x] 0.6 Palette UI streaming + cards + Settings Keys + secrets — verified: 186 tests green incl. redaction (keys never in logs) + secrets precedence/ciphertext; smoke boot `SMOKE_OK … e2e=turn-ok` proves renderer→IPC→orchestrator→fast-path→events round trip; manual look-and-feel script in HUMAN_TODO
Planned files:
- apps/desktop/src/main/{logger.ts, config.ts, shortcuts.ts}
- apps/desktop/src/main/security/secrets.ts (+ secrets.test.ts)
- apps/desktop/src/main/settingsService.ts (+ test)
- apps/desktop/src/main/ipc/handlers/index.ts
- apps/desktop/src/main/index.ts (full bootstrap: db, repos, registry, orchestrator, router, shortcuts)
- apps/desktop/src/main/logger.test.ts (redaction: keys never in logs)
- apps/desktop/src/renderer/state/store.ts, windows/palette/* (streaming UI), windows/settings/* (Keys tab), components/cards/{TextCard,TimerCard,WeatherCard,ConfirmCard}.tsx
- HUMAN_TODO.md: manual palette verification script
Verify: unit tests incl. redaction grep; smoke boot proves window.apollo bridge + streaming turn end-to-end with stub LLM.

### [x] 0.5 Orchestrator with FakeLLM scripted tests — verified: 23-test suite green (tool loop, parallel calls, 8-iter cap, taint flags incl. user-stated exemption, confirm approve/deny/lexicon/supersede/expiry, email cancel-window abort, dead-end guard + capability_misses, silent cancellation, fast-path LLM bypass, perf spans, context assembly)
Planned files:
- apps/desktop/src/main/agent/{llm.ts, llmFake.ts, systemPrompt.ts, confirmations.ts, taint.ts, orchestrator.ts}
- apps/desktop/src/main/agent/{taint.test.ts, orchestrator.test.ts}
Verify: scripted suites for tool loop, parallel calls, taint flags, confirmation approve/deny/supersede/expiry/lexicon, email cancel-window, dead-end guard + capability_misses, cancellation, 8-iteration cap, fast-path bypass, perf spans.

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
