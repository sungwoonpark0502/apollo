# PROGRESS

## Phase 8 (Part H — Hardening, Trust, Polish)

### [x] 8.1 Data safety — verified: migration 0005 (action_log, usage_log, conv index); ErrorCode +THROTTLED/REAUTH_NEEDED/DB_CORRUPT with copy; backup module (VACUUM INTO + checkpoint/copy fallback, 3 reasons, retention newest-5-per-class) + boot integrity (PRAGMA quick_check → quarantine corrupt + restore newest backup or start fresh) — 9 tests incl. deliberately-corrupted fixture recovery; export/import (zip: notes/*.md with full-id filenames, calendar.ics with RRULE/EXDATE + round-trip parser, todos/reminders/facts json, settings.json, optional conversations.jsonl) — 6 tests incl. **secrets-absent proof** (stored vault keys never appear in any export member) + id-merge skip-existing; pre-migrate backup hook + weekly auto-backup on boot; backup/export/import IPC channels + Privacy "Data" section (Back up now, backup list+restore, Export w/ chats toggle, Import); settings voice/usage/backup schema. Full suite 615 green; smoke green.

## Phase 7 (Part G — Semantic Memory + Recall)

### [x] Phase 7 GATE — all green
- Full unit/integration suite: **596 tests** (96 shared + 500 desktop) pass under Node ABI.
- Injection suite (release gate): **14/14 = 100%**; recall results flow through the untrusted/taint machinery (`<data source="recall.search">`).
- Egress guard (G8): zero `fetch` during index + recall; C14.9 allowlist unchanged, no `huggingface.co` at runtime; model fetched build-time only.
- Retrieval perf (G4): recall.search **p95 4.2ms** over 10,000 chunks (budget 150ms), FakeEmbedder + real sqlite-vec.
- On-device real model verified (MiniLM q8): dim 384, semantic ordering holds (dentist↔dental 0.74 vs 0.20). CI/tests need no model files (FakeEmbedder).
- Grep gates pass (no exec/child_process); `pnpm audit --prod` clean; lint + strict typecheck clean.
- Real-LLM eval: harness parses all 116 rows (incl. 10 new recall rows) and self-SKIPs without ANTHROPIC_API_KEY (documented in HUMAN_TODO; C22 CI runs it when the secret exists).
- Phases 0–6 suites re-run green — nothing broke.

### [x] 7.6 Privacy Memory-index section + rebuild/clear + history-off purge + README — verified: settings.memory.indexEnabled flag; memory.indexStats/rebuild/clear IPC channels (round-trip fixtures); indexer gains indexEnabled gate (no enqueue/drain when off) + clear() (purge chunks+vectors); chunksRepo sizeBytes estimate; main handlers (rebuild re-enables + rescans, clear disables + purges, stats reports per-kind counts/pending/size/embedder); Privacy tab "Memory index" section (on-device sentence, live counts + MB, embedder state, Rebuild/Clear buttons) + history-off hint; 3 new indexer tests (clear drops all, disabled gate blocks enqueue, rebuild re-chunks corpus); egress guard test (2: zero fetch during index+recall, allowlist unchanged/no huggingface.co); README semantic-memory section + fetch-models script row; smoke green. Full suite 595 green.

### [x] 7.5 Workspace omnisearch (Cmd/Ctrl+K) + recall.query IPC — verified: recall.query IPC channel (mirrors tool params, returns recallList items) + events.search channel (title/location LIKE, top 8) with round-trip + malformed fixtures; OmniSearch overlay (560px centered, 150ms debounce, grouped Notes[recall note]/Events[events.search]/Facts[recall fact], ≤10 total, arrow+Enter nav across groups, hover-sync, Esc close, note→notes view / event→calendar at date / fact→Settings Privacy); Cmd/Ctrl+K toggle wired into WorkspaceApp; keyboard-nav manual QA added to HUMAN_TODO; smoke green. Full suite 587 green.

### [x] 7.4 Memory-fact dedupe/replace/forget-by-similarity — verified: pure thresholds (decideFactAction: >0.90 update, 0.75–0.90 replace, <0.75 insert; boundary tests) + matchFact/resolveForget with controlled stub vectors; memory.save now embeds the new fact vs same-category facts → updates in place (same row) on near-dup, soft-deletes old + inserts new (memory.replace undo) on contradiction, inserts when unrelated, only compares within category; memory.forget resolves by top-1 cosine>0.6 else lists ≤3 nearest and does nothing; 13 new tests (thresholds + tool integration incl. same-category isolation); memory.replace undo inverse (restore old + delete new); embedder wired into the tool in main. Full suite 586 green.

### [x] 7.3 recall.search tool + hybrid ranking + recallList card + system prompt + eval rows — verified: pure ranking (9 tests: 0.75·cosine+0.25·keyword blend + ordering, recency decay newer-wins, per-ref collapse, l2→cosine inversion, keyword-fraction score, llmText numbering/empty) + real sqlite-vec e2e over FakeEmbedder (keyword match, kinds filter, sinceIso filter); recall.search tool (Tier 1, untrusted:true → orchestrator wraps `<data source="recall.search">` + sets conversation taint, confirmed); recallList card kind + RecallListCard renderer (kind icon/title/snippet/date, note rows deep-link to notes view, message/fact expand inline); system-prompt "Past references" paragraph appended (call recall before answering, never invent, offer to save on empty); recall.query IPC channel + handler (for 5.x omnisearch); 10 eval rows added (5 recall triggers, 1 fabrication guard via 'submarine' sentinel → reply "couldn't find", 4 forbid rows); injection suite still 14/14 100%; smoke green. Unit suite 573 green. Real-LLM eval runs at the phase gate.

### [x] 7.2 Migration 0004 + sqlite-vec + chunksRepo + chunker + indexer — verified: sqlite-vec 0.1.9 loaded into the existing better-sqlite3 connection (real KNN smoke passes); migration 0004 (chunks table + vec_chunks vec0[384]); chunker (12 tests: blank-line split, 1000 cap, 1-sentence overlap, title prepend, message/fact prefix); chunksRepo (6 tests incl. real vector KNN ordering, replace removes stale vectors, keyword LIKE, purge/pruneOldestMessages order); indexer (14 tests: 5s note debounce, re-chunk-on-edit replaces, delete removes, message index gated on history + immediate purge on history-off, fact upsert/remove, canDrain gating then drain when gate opens, boot rescan of unembedded, growth-cap prunes messages-first-never-notes/facts); wired into main (embedderFactory, orchestrator onMessagePersisted hook excludes tool rows, memory-tool fact hooks, activeTurns+voice-idle drain gate, history-toggle purge, Diagnostics embedder state + queue depth); migration version test → v4; smoke boot clean (no vec/index errors). Full suite 562 green.

### [x] 7.1 Embedder adapter (real + Fake) + fetch-models.ts + config + Diagnostics state — verified: Embedder contract with FakeEmbedder (deterministic FNV-seeded 384-dim L2-normalized vectors, 5 tests incl. determinism/dim/norm/empty/cosine-bounds) and a real MiniLM adapter (transformers.js, dtype q8 → quantized ONNX, batch 8, mean-pool, L2-norm, env.allowRemoteModels forced false = never downloads); scripts/fetch-models.ts fetched the model at build time (23MB quantized ONNX + tokenizer, SHA-256 recorded in DECISIONS); real-model smoke confirmed on-device semantics (cos dentist↔dental 0.74 vs 0.20 unrelated), gated behind file presence so CI passes on Fake with zero model files; adapters.embedder setting ('auto'=real when files exist); embedderFactory selects real/fake; model files gitignored; A2 offline instructions in HUMAN_TODO. Full suite still green.

## Phase 6 (Part F — Proactive Engine + Quick Capture)

### [x] PHASE 6 GATE — Quiet invariant made testable; nothing from Phases 0–5 regressed.
- **Acceptance bar**: the governor suite proves budget, DND, dedupe, spacing, fullscreen deferral, batching, and auto-tune with an injected fake clock (16 tests); Quick Capture saves with zero LLM and appears live in the Workspace (service live-sync test + boot smoke `capture.classify`+`capture.submit`+`todos.list`).
- **Full suite**: `pnpm lint` PASS, `pnpm -r typecheck` 0 errors, **538 tests** (90 shared + 448 desktop) green — up from 438 at the Phase 5 gate.
- **Injection suite**: 100% (14 tests) — release gate intact after Part F (no LLM path added by proactivity; needs_reply renders email as inert text, never an LLM input).
- **Grep-gate** (no `child_process`/bare `exec(`): PASS. No new egress hosts (weather + Gmail metadata reuse the existing allowlist).
- **Eval**: harness loads all **106 rows** (96 + 10 Part F) and self-skips without a key (C22).
- **Build**: `pnpm build` compiles all renderer entries incl. the new `capture` window.
- **HUMAN_TODO**: gained the proactive visual/behavioral QA checklist + the one genuine platform gap (cross-app fullscreen detection is an Electron limitation; the governor already defers correctly once the callback returns true).
- **Perf**: governor processes a 50-candidate batch in <10ms (F7).

### [x] 6.6 Settings Proactive tab + proactive.configure/status tools + eval rows + README — verified: proactive tools (6 tests: configure disables a named rule w/ undo token, "all" toggles master, undo restores prior state, zod rejects unknown ruleId, status reports enabled names + budget, tier 1 vs 2); tools registered + system-prompt guidance (configure/status only on explicit requests, informational Qs use data tools); 10 Part F eval rows (4 configure incl. "stop all nudges", 2 status incl. "why did you ping me", 4 forbid_tools proving "what meetings do I have"→calendar.list not proactive) — harness loads all 106 rows; Settings Proactive tab (master toggle, maxPerDay stepper, voiceOnNudges, per-rule enable + inline params, quiet explanation, Recent-nudges list via proactive.recent); General tab gains Quick Capture hotkey + default type + open-Workspace-on-launch; README documents proactive + Quick Capture. Full suite 538 green; smoke green.

### [x] 6.5 Quick Capture window + classifier + hotkey + tray items — verified: classifier golden set (16 tests: plain note verbatim, empty→default, leading "todo "/"TODO " strip, trailing "!"/"!!" strip, "call mom tomorrow at 6"→reminder with time phrase stripped, bare-hour-3→PM future, "in 30 minutes", past/no-time→note, defaultType todo, todo-prefix beats time, Tab cycle Note→Todo→Reminder skipping Reminder when no time); save-path service (5 tests incl. the E9 live-sync harness: captured note visible via notes.list within one tick with data.changed, todo/reminder saves + scheduler re-arm, empty-text rejection); frameless 520x64 capture window (live chip via 50ms-debounced capture.classify, Tab cycle, Enter save with 150ms check morph, Esc/blur close, 2px shake on empty); global hotkey (CommandOrControl+Shift+N, re-registered with the palette hotkey on change); tray "Quick capture" item. Smoke e2e now exercises classify+submit+live-list (zero LLM). Full suite 531 green.

### [x] 6.4 needs_reply + weather_heads_up rules (conditional skip) — verified: 10 tests. needs_reply (Gmail-conditional): skips silently when not connected (facade never called), fires at atHH with a max-3 inert-text digest (count reflects all threads, sender/subject never LLM-fed), before-atHH/no-threads negatives; wired to a read-only Gmail search `is:unread to:me -in:sent older_than:Nd`. weather_heads_up (homePlace-conditional): skips when home unset (facade not called), fires at precip>=70 with a located event, boundary 69-vs-70 (< vs =), no-located-event and before-07:30 negatives; wired to Open-Meteo hourly precip max over 12h. Both facades threaded through engine+controller RuleCtx; engine tick includes their hours. Proactive suite 54 green.

### [x] 6.3 Delivery UI: orb accent dot + pulse, nudge cards, grouped digest, outcome recording, auto-tune meta-nudge — verified: proactive controller (8 tests: single-nudge delivery + live tracking, OS notification only for meeting_lead, dismiss→outcome+clear, 20s auto-dismiss→expired via fake clock, snooze→re-deliver after 5min, primary "open"→deep-link+acted, auto-tune "disable"→rule off in settings, status→enabled names+remaining budget); controller wires engine→suggestion.show push, records outcomes/snooze/disable, deep-links, OS notification, TTS one-liner (voiceOnNudges && time-sensitive && !DND); OrbApp renders NudgeCard/NudgeGroupCard with actions, plays nudge.wav (skipped when silent), shows an accent dot + gentle pulse on the idle orb, 20s auto-dismiss; powerMonitor resume re-runs the engine. Cross-app fullscreen detection stubbed false (Electron limitation) → HUMAN_TODO. Full suite 499 green; smoke green.

### [x] 6.2 Engine + governor + fake-clock harness + rules (meeting_lead, tomorrow_preview, overdue_todos) — verified: governor suite (16 tests, injected fake clock) proves the full Quiet pipeline — dedupe across restart, expiry, DND (time-sensitive silent / low-normal deferred to DND-end+1min), budget exhaustion (defer to tomorrow, drop if expiring, time-sensitive exempt), busy 30s defer, fullscreen 10min defer (time-sensitive delivered), 20-min spacing, batching into a group of 4 with overflow deferred, auto-tune meta-nudge after exactly 5 negative outcomes (once/30 days), master switch, and 50-candidate batch <10ms; rules suite (14 tests: meeting_lead positive/negative/after-start/all-day-excluded/stable-dedupe, tomorrow_preview >=3-or-early/before-atHH/negative, overdue_todos >24h/boundary/completed/before-atHH/cap-5); engine suite (6 tests: throwing rule isolated, busy-deferred delivery after fake-clock advance, dedupe across re-run, snooze re-entry with suffixed key, recordOutcome, master switch). Full suite 491 green.

### [x] 6.1 Contracts + migration 0003 + suggestionsRepo + nudge/nudgeGroup cards + earcon — verified: shared contracts (Urgency/SuggestionAction/SuggestionDTO in agent.ts; nudge + nudgeGroup card kinds + suggestionDTOSchema in cards.ts with z.lazy to break the CardPayload recursion; suggestion sub-schemas inlined in cards.ts to avoid a runtime import cycle that broke agentEventSchema); settings proactive{enabled,maxPerDay,voiceOnNudges,rules} + quickCapture{hotkey,defaultType}; new channels suggestion.action/capture.open/capture.submit (invoke) + suggestion.show/capture.result (push) with round-trip + malformed fixtures; migration 0003 (suggestions table, unique dedupe index); suggestionsRepo (10 tests: dedupe by rule+key, dedupe across restart, budget count of shown low/normal in local day w/ time-sensitive exempt, lastShownAt spacing, recentOutcomes newest-first, idempotent markShown, lastShown, wipeAll); nudge.wav earcon (720Hz 90ms, -18 LUFS). Full suite 455 green.

## Phase 5 (Part E)

### [x] PHASE 5 GATE — one-brain acceptance met and nothing from Phases 0–4 regressed.
- **One-brain (acceptance bar)**: voice/palette/Workspace share the same repos; live sync proven by the DataBus fan-out + same-tick `notes.save`→`notes.list` tests and the boot smoke (`e2e=turn-ok` writes via a Workspace channel and reads it back over IPC with `data.changed` observed).
- **Full suite**: `pnpm lint` PASS, `pnpm -r typecheck` 0 errors, **438 tests** (80 shared + 358 desktop) green.
- **Injection suite**: 100% (14 tests) — release gate intact after Part E.
- **Grep-gate** (no `child_process`/bare `exec(`): PASS.
- **Eval**: harness loads all **96 rows** (81 base + 15 Part E) and self-skips without a key (C22); real ≥92% run remains the one keyed HUMAN_TODO item.
- **Build**: `pnpm build` compiles all renderer entries incl. the new `workspace` window; `wsRendered=true` in smoke.
- **HUMAN_TODO**: gained the Part E visual-QA checklist (drag, Stage animations, dark mode, reduced motion); everything else self-verified.

### [x] 5.7 Onboarding v2 + Settings Profile/About + live settings broadcast + app.open + eval rows + README — verified: app.open tool (Tier 2, 4 tests: opens view/reports, omits optional fields, tier/networked, zod rejects unknown view) registered + system-prompt guidance (explicit-verb only vs calendar.list); geocode cache lib (3 tests: normalized-key caching hits once, empty skips network, distinct keys); 15 Part E eval rows added (6 app.open, 2 forbid_tools calendar.list-not-app.open, 4 weather-profile-default, 3 dictated-note) — harness loads all 96 rows + self-skips w/o key; Settings gains Profile tab (name, home PlaceSearch autocomplete via geocode.search IPC, units/timeFormat/weekStart segmented, all live-broadcast) + About tab (version, check-updates, licenses, logs); Onboarding v2 = 6 steps (Welcome, Profile w/ geocode autocomplete, Permissions, Keys, Wake word, Try it) → finish opens Workspace Today; README documents the three surfaces + one-brain live sync. Live settings broadcast (settings.changed) already wired in 5.2. Full suite 438 green; smoke green.

### [x] 5.6 Response Stage + spoken-row sync + deep links + weather fast path + icons — verified: weather fast path (fastPath suite 19 tests incl. E5 now/forecast variants + place-given/horizon near-miss negatives; orchestrator executes weather.now/forecast with template spoken reply + Stage card, zero LLM); pure stage lib (8 tests: isStageCard voice-only trigger, rowCount, best-effort sentenceToRow never-throws, stageTitle, stageDeepLink); StageCard (480px translucent surface, 160ms fade+rise, 35ms row stagger, 300ms temp count-up, best-effort accent bar on spoken row via tts.spoken push, "Open in Apollo" deep link, hourly/4-day weather w/ SVG glyph set, reduced-motion collapses to plain fade); orb widens + 12s Stage dismiss; voice-turn detection via voice.state. Smoke green (orb+workspace render). Full suite 429.

### [x] 5.5 Notes two-pane + FTS search + autosave + pin + delete undo toast — verified: pure debounce lib (6 tests: trailing-edge fire w/ latest args, flush on blur/close, cancel, burst coalescing; wordCount) covering the E9 autosave-debounce requirement; two-pane view (280px rail w/ 200ms-debounced FTS-as-you-type, Pinned section then updated-desc list, New note; plain-textarea editor w/ 800ms autosave + blur/unmount flush, saving/saved indicator, word count, pin toggle, delete→5s undo toast wired to undo.apply); notes created by voice appear live via data.changed (proven by 5.1 live-sync test + boot smoke's notes.save→notes.list round-trip); Cmd/Ctrl+F focuses search. Full suite 444 green.

### [x] 5.4 Week timeline + drag create/move/resize + Agenda — verified: Week view (7-col 24h scrollable, 6:00 initial scroll, pinned all-day row, red now-line updating each minute, pointer-drag empty→create w/ 15-min snap, drag chip→move, bottom-edge→resize, all persisting via events.update w/ scope dialog on recurring, overlap lanes via tested layoutOverlaps); Agenda (next 60 days grouped by day, click→editor, recurring delete→scope dialog). Drag math (snap15/layoutOverlaps) pure-tested in 5.1/5.2; pixel-precise drag interactions added to HUMAN_TODO visual-QA checklist. Smoke wsRendered=true. Full suite 408 green.

### [x] 5.3 Calendar Month + day panel + quick-create + event editor + scope dialog — verified: recurrence preset lib (13 tests: buildRRule for all presets w/ start-weekday/day-of-month awareness, detectPreset round-trip, isValidRRule live validation); Month 6x7 grid w/ ≤3 chips + "+N more" + today ring; right-side day panel; double-click quick-create popover (time picker, 30m/1h/2h/all-day presets, "full editor" escape hatch); EventEditorModal (title, all-day, start/end, searchable tz, recurrence presets w/ live custom-RRULE validation, location, notes, reminder); mandatory ScopeDialog on recurring edit/delete routing to events.update/delete scope single|all (single reuses C7 detach, proven in bus.test.ts). Smoke: wsRendered=true (workspace React tree incl. rrule-in-renderer loads clean). Full suite 408 green.

### [x] 5.2 Workspace shell + rail + Today view + entries + settings.changed — verified: Workspace window (single-instance, bounds persisted in settings blob, min 860x600); rail with Today/Calendar/Notes/Settings + Cmd/Ctrl+1-3 & T shortcuts; Today view (greeting, up-next, today's schedule, live todos w/ inline add + overdue tint, weather strip w/ 6h hourly + SVG glyphs, latest-brief w/ Regenerate) all wired to live data.changed via useDataSync; entries: tray left-click + "Open Apollo" → Workspace, settings.changed broadcast on any non-bounds settings write; calendarLayout pure lib (12 tests: month grid both weekStarts + DST months, overlap lanes, snap15, stagger). Smoke: e2e=turn-ok (note saved via notes.save → listed via notes.list → data.changed observed, all over IPC), workspace=true. Full suite 395 green.

### [x] 5.1 Contracts + migration 0002 + DataBus + new IPC handlers — verified: 16-test suite (bus fan-out/unsubscribe/throwing-subscriber, wrapMutations publish-on-success/silent-on-noop across events/todos/reminders/timers/notes, FTS trigger integrity incl. integrity-check pragma + exactly-one-row proof, title/snippet derivation, live-sync same-tick visibility, workspace handler semantics: scope-single detach reusing C7, undo-toast round-trip, todos ordering, pin float); every new channel has round-trip + malformed-rejection fixtures (shared suite 74); full suite 380 green
Planned files:
- packages/shared/src/settings.ts (profile object per E1; home/units fold into profile)
- packages/shared/src/cards.ts (OccurrenceDTO reshaped to E1: occStartTs/occEndTs/isRecurring; NoteListItem)
- packages/shared/src/ipc.ts (+ workspace.open, events.*, notes.*, todos.*, undo.apply invokes; data.changed + settings.changed pushes)
- packages/shared/src/ipc.test.ts (fixtures for every new channel + malformed rejection)
- apps/desktop/src/main/db/migrations/0002_workspace.sql (pinned, idx_notes_updated, FTS triggers — external-content 'delete' form)
- apps/desktop/src/main/db/migrate.ts (register 0002)
- apps/desktop/src/main/db/repos/notes.ts (drop manual FTS sync — triggers own it; pinned; list w/ title/snippet derivation)
- apps/desktop/src/main/db/bus.ts (DataBus + repo wrapping)
- apps/desktop/src/main/db/repos/index.ts (wrap mutating repos with bus)
- apps/desktop/src/main/db/{bus.test.ts,repos updates in repos.test.ts}
- apps/desktop/src/main/ipc/handlers/workspace.ts (+ wire into handlers/index.ts)
- apps/desktop/src/main/{index.ts wiring: data.changed broadcast}
- events repo: expandOccurrences DTO rename; calendar tools updated
Verify: new-channel round-trips + malformed rejection, bus fan-out tests, FTS trigger integrity tests, note title/snippet tests; full suite stays green.

## Phase 4

### [x] Phase 4 — screen.context (real osascript-verified: read "Google Chrome"), memory-facts UI + per-row delete, egress list, approved-dirs editor, Wipe-all-data (typed ERASE → deletes DB+secrets+relaunch), General/Voice/Accounts/Privacy/Diagnostics tabs, 4-step onboarding (permissions prompts via systemPreferences), reduced-motion + focus-ring a11y pass, electron-builder packaging (dmg/zip arm64+x64, nsis; hardened runtime + notarize config present), electron-updater wiring, README (setup/keys/permissions/architecture map).

### [x] GLOBAL DEFINITION OF DONE
- All phase gates green (0.1–4).
- `pnpm lint && pnpm -r typecheck && pnpm -r test` clean: **345 tests** (55 shared + 290 desktop), 0 `any` in shared/exported signatures (lint-enforced).
- Injection suite 100% (release gate). Perf harness p95 ~6ms << 250ms.
- `pnpm --filter @apollo/desktop package` produced a real installable **Apollo-0.1.0-arm64.dmg (182 MB)**.
- Eval harness runs; real-LLM run self-skips without a key (green-with-mock, C22) — real run is the one HUMAN_TODO gate item that needs an Anthropic key.
- HUMAN_TODO contains only physical-human items (account logins, payments, code-signing certs, live-mic acoustic checks).
- README + HUMAN_TODO take a new machine from clone → running app.

Remaining (all HUMAN_TODO, none blocking build/test): provider API keys (Anthropic/Deepgram/Picovoice/Brave), Google OAuth client, code-signing/notarization certs + update-feed URL, and the physical live-audio checklist.

## Phase 3

### [x] Phase 3 GATE — verified: injection suite 100% (7/7 — forward-inbox, exfil-system-prompt, hidden-white-text, base64-decode, open-terminal, feed-item-instruction + coverage check; a fully-compromised FakeLLM cannot send Tier 3 without confirmation, recipient taint flags always present, planted secret never leaks, openApp never receives a shell string); "send without confirmation is impossible" proven structurally (Tier 3 gate in orchestrator code, cannot be disabled); "good morning" → spoken brief + brief card stack with no LLM call (orchestrator test) from real data (weather via live Open-Meteo confirmed keyless, news via keyless RSS). Injection suite added as a named CI release gate. Full suite: 335 tests, lint + typecheck clean.

### [x] 3.3 brief.daily + morning schedule + BriefCard — verified: brief.daily composite (3 tests: composes paragraph+card stack from calendar/weather/news, degrades with a couldn't-reach note on sub-tool throw, unread-email highlight when connected); dailyBrief scheduler (5 tests: computeNextBrief today/tomorrow, fires when active, defers+fires-on-return when away, re-arms next day); "good morning" fast-path intent → runs brief.daily with no LLM call (orchestrator test), also fired on schedule at brief time; BriefCard recursively renders sub-cards; activity tracking (input in last 10 min) drives deferral. 328 tests green.

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
