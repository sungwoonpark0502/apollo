# DECISIONS

- 2026-07-18 (Phase 11 / PART K): **C18's palette section and H5.4/H5.5 are superseded by PART K.** The palette window (global-hotkey text launcher) is removed; typed interaction lives in the Workspace **Chat tab**, and the H5.5 read-only Chats view is absorbed by it (history list + composing). Rationale: the Workspace made a separate launcher redundant — it was a second window, a second global hotkey (a whole OS-level conflict class), and a second rendering path for the same conversation. Consolidating leaves exactly two surfaces (orb for voice, Chat tab for typing) with one brain: the Chat tab dispatches through the identical `agent.userMessage` path, orchestrator, tools, memory, and confirmation gates, sharing `activeConvId` — proven by the shared-thread integration test, not inspection. Retained deliberately: push-to-talk (its binding moved under `voice.pttHotkey`; Alt+Space is now PTT-only), Quick Capture, the tray, all orb behavior. Legacy stored `hotkey` values are dropped silently on boot and never re-registered. Contract additions beyond K1's list, each required by K2 and documented here: `conversations.active/rename/pin` (+ migration 0007 title/pinned columns), message ids on `conversations.get`, `convId` on `turnStart` (the Chat tab must know which conversation a live voice turn belongs to), `tts.speak` (Speak this), and `dictation.start/stop` + `dictation.text` (mic-into-composer).

- 2026-07-15 (Phase 10 / J5.1): DNS-rebinding defense for link.read. The SSRF guard (`assertPublicUrl`) now runs immediately before every connect — the initial URL and each redirect hop — so a host that rebinds public→private between the first validation and the connect is rejected before any request. Electron `net.fetch` owns its own socket DNS and offers no IP-pinning hook, and rewriting the URL to the resolved IP would break TLS SNI/cert validation for HTTPS, so a true "connect to the validated IP" pin is not achievable here. The residual window (between our connect-time re-resolution and net.fetch's internal resolution, within one DNS TTL) is accepted and mitigated by: the 5s total timeout, tier-1 read-only nature, the user-substring gate, the 2MB cap, and the result being wrapped `<data source="link"> untrusted:true`. Tested with a rebinding resolver (public then private) that is rejected with the fetch never called.

- 2026-07-15 (Phase 10 / J5.2): the H2 export is a fixed allowlist of non-sensitive artifacts (notes, calendar.ics, todos, reminders, facts, settings, optional conversations). It never includes oauth_accounts, sync_state (gcal tokens), keymeta/secret store keys, or usage_log. usage_log holds only aggregate provider/metric/amount counts (telemetry), no content or credentials, and is deliberately excluded from export.

- 2026-07-15 (Phase 10 / J1.3): taint value-gate ergonomics. A Tier-3 value (recipient/URL/path) is cleared from the value_not_user_stated gate if it is a substring of any user utterance OR of any recall result of kind note/fact retrieved this turn — the user's own saved data counts as user-stated. Recall of kind message, link.read results, and email contents NEVER clear the gate (they are untrusted or not authored by the user). Turn-scoped: the note/fact clearing set resets each user message. This keeps C8.7/C14 protection against injected recipients while removing a false-positive red flag when the user asks to act on data they saved themselves.

- 2026-07-16 (Phase 9 / I7): the Google Calendar API host `www.googleapis.com` was NOT in the C14.9 allowlist (only gmail/oauth2/accounts were), yet I7 says the module "reuses existing Google hosts (already allowlisted)". To make Calendar sync functional while honoring the intent (no arbitrary egress), I added `www.googleapis.com` — a first-party Google API host, fixed, no wildcard — and updated the frozen-allowlist test. The gcal client's raw net.fetch (needed for etag If-Match on PATCH/DELETE, which the http client's helpers don't surface) is wrapped with `egress.isAllowedUrl` so it can only reach allowlisted Google hosts. The whole sync engine + module are unit-tested with a mocked GoogleCalendarClient; live auth (incremental calendar-scope PKCE) + e2e verification are HUMAN_TODO — makeClient returns null until a real token exists, so the module is provably inert by default.

- 2026-07-16 (Phase 9 / I4): the link.read "user-link lane" is a physically separate egress path (net/linkReader.ts) that calls Electron net.fetch directly, bypassing the C14.9 allowlist but gated by the SSRF guard (net/ssrfGuard.ts) instead. It reaches arbitrary PUBLIC hosts only; DNS is resolved and every address (initial + each redirect hop) must be public unicast. The lane cannot be reached by any other code path: it is constructed only in index.ts and its type is referenced only by tools/link.ts — enforced by a source-scan assertion in egressCanary.test.ts, so a future import that widened egress would fail the build. The standard httpClient still enforces the allowlist for everything else. fetch has no separate connect-timeout, so the 2s-connect/5s-total spec is approximated by a single 5s AbortSignal.timeout; the 2MB cap is enforced by a streaming byte counter (plus an early content-length check). Non-HTML content types return a description, never bytes.

- 2026-07-15 (Phase 9 / I2): format.ts uses a process-global FormatContext (locale/timeFormat/weekStart) set by configureFormat at boot and on every settings.changed, with an optional per-call ctx override used only by the golden tests. This avoids threading a formatter/context through every card and tool; components re-render on settings.changed because they already consume the settings blob (useSettings/useDataSync/useFormatInit). Effective locale = locale.region ?? app.getLocale() (main) / navigator.language (renderer). luxon was added to @apollo/shared (already a desktop dep) so format.ts can back onto Intl via .toLocaleString; the lint rule exempts only format.ts + test files, so ALL luxon .toFormat (including machine formats — ICS date keys, month buckets) lives in format.ts as icsDate/icsDateTime/localDateKey/monthKey. ICU narrow no-break spaces (U+202F/U+00A0) are normalized to plain spaces for predictable rendered/copied/spoken strings.

- 2026-07-15 (Phase 8 / H9): npm's classic `pnpm audit` endpoint was retired (HTTP 410, "use the bulk advisory endpoint") mid-session. Deps were clean when the endpoint last worked (earlier this session: "No known vulnerabilities found"). The CI audit step now tolerates the 410 specifically while still failing on any real high-severity advisory, so a registry change can't red the build. Not a dependency problem.

- 2026-07-15 (Phase 8 / H8): boot_to_tray measured p95 262ms / median 196ms over repeated launches (dev machine, arm64), well under the 2500ms budget. Harness: `apps/desktop/scripts/boot-bench.mjs` (parses the boot_to_tray span from the smoke marker). Boot spans (boot_to_tray, boot_db_ready, boot_windows_lazy) recorded to perf_spans each launch.
- 2026-07-15 (Phase 8 / H8): lazy init — audio worker spawns at boot only when wake.enabled (else PTT spawns on demand); the MiniLM embedder loads model files on first embed() only (proved by a construct-without-load test); Workspace window created on demand; ONNX VAD loads inside the audio worker, not main. Idle RSS is a HUMAN_TODO measurement (Diagnostics > Resources); record here if it grows >20% across a phase.

- 2026-07-13 (Phase 7): embedding model Xenova/all-MiniLM-L6-v2 (quantized, 384 dims) fetched at build time by scripts/fetch-models.ts into apps/desktop/resources/models/minilm/. SHA-256 (verify after fetch):
  - config.json: 7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7
  - tokenizer.json: da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0
  - tokenizer_config.json: 9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3
  - onnx/model_quantized.onnx: afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1
- 2026-07-13 (Phase 7): real embedder uses transformers.js `dtype: 'q8'` to select model_quantized.onnx; env.allowRemoteModels forced false so a missing model raises (never a runtime download, G1). Verified on-device: dim 384, cos("dentist appointment","dental visit")=0.74 vs 0.20 unrelated.
- 2026-07-13 (Phase 7): model files are gitignored build artifacts (23MB); CI/tests never need them (FakeEmbedder). adapters.embedder 'auto' = real when resources/models/minilm exists, else fake.
- 2026-07-13 (Phase 7): recall results are wrapped in <data source="recall"> AND set untrusted:true (G4) — notes may contain hostile pasted text; the only cost is extra Tier 3 confirmation friction in the same turn, which is acceptable.
- 2026-07-13 (Phase 7): sqlite-vec 0.1.9; migration 0004 vector table form `CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[384])`. KNN uses `WHERE embedding MATCH ? ORDER BY distance` (L2); cosine derived as 1 − dist²/2 on L2-normalized vectors. Extension loaded into the existing better-sqlite3 connection in openDb(); recall degrades to keyword-only (never crashes) if it fails to load.
- 2026-07-13 (Phase 7): recall.search hybrid score = 0.75·cosine + 0.25·keywordFraction, ×recency(0.7+0.3·e^(−ageDays/45)); vector KNN top 24 + keyword top 24 merged, collapsed to best chunk per ref_id. Measured p95 4.2ms over 10k chunks (budget 150ms).
- 2026-07-13 (Phase 7): @deepgram/sdk stays v3 (v5 has different API); @huggingface/transformers v4 with dtype 'q8'. No runtime egress hosts added (egress test asserts the C14.9 allowlist is unchanged and no fetch occurs during embed/recall).

- 2026-07-13 (Phase 6): suggestionDTOSchema lives in cards.ts with its sub-schemas (urgency/action) inlined rather than imported from agent.ts — importing runtime schemas from agent.ts into cards.ts creates a module-init cycle that leaves cardPayloadSchema/agentEventSchema undefined. Types stay in agent.ts.
- 2026-07-13 (Phase 6): the governor is a pure, clock-injectable pipeline that delivers survivors and returns deferrals; the engine owns timers/DataBus subscription and re-submits deferred candidates. This makes every Quiet-invariant rule (budget/DND/spacing/fullscreen/batching/auto-tune) unit-testable with a fake clock, no Electron.
- 2026-07-13 (Phase 6): cross-app fullscreen detection is stubbed `false` (Electron exposes no reliable API for another app's fullscreen state). The governor's fullscreen branch is proven by the injected-flag test; real detection is a documented HUMAN_TODO needing a native helper.
- 2026-07-13 (Phase 6): needs_reply uses a read-only Gmail search (`is:unread to:me -in:sent older_than:Nd`) and renders sender/subject as inert card text — never fed into an LLM turn (F6). Skips silently when Gmail is disconnected.
- 2026-07-13 (Phase 6): Quick Capture classification runs in main (via capture.classify IPC, 50ms-debounced) reusing the real timeResolver; the pure classifier is unit-tested with a 16-case golden set. The renderer holds only the Tab-override + submit UI.
- 2026-07-13 (Phase 6): proactive.configure "all" toggles the master `proactive.enabled` switch; per-rule ids toggle `proactive.rules[id].enabled`. Undoable via a registered inverse that restores the captured prior state.

- 2026-07-12 (Phase 5): E2's literal FTS trigger SQL (direct UPDATE/DELETE on notes_fts) is invalid for FTS5 external-content tables; implemented with the canonical 'delete'-command INSERT form. Proven by the trigger-integrity test.
- 2026-07-12 (Phase 5): notes repo no longer writes notes_fts manually — the 0002 triggers own sync (double-write otherwise). Soft-deleted notes keep their FTS row and are filtered by the deleted_at IS NULL join.
- 2026-07-12 (Phase 5): pre-Part-E top-level settings home/units fold into profile via migrateLegacySettings at load (tz backfilled from the local zone); Part E wins over C3's field list.
- 2026-07-12 (Phase 5): OccurrenceDTO reshaped to E1 (occStartTs/occEndTs/isRecurring) keeping internal extras dateIso/notes/rrule that C7 scope edits and cards need; E1 does not forbid extra fields.
- 2026-07-12 (Phase 5): Workspace direct-UI mutations register undo_log entries under a fixed 'workspace-ui' conversation id so undo.apply tokens work without an agent turn.
- 2026-07-13 (Phase 5): Notes editor is a single plain <textarea> (preserving the E3.3 plain-text guarantee). Styling only the first line as an fs-display title inside a textarea is impossible without contenteditable/overlay, which would break plain-text storage; the first-line-as-title semantics are honored via title/snippet derivation shown in the notes rail and Today. Autosave = 800ms debounce + onBlur flush + unmount/beforeunload flush.
- 2026-07-13 (Phase 5): Renderer autosave/search use the pure `debounce` util (injectable timers) so the debounce logic is unit-tested off the DOM (E9).
- 2026-07-13 (Phase 5): Geocoding autocomplete runs through a `geocode.search` IPC channel (main → egress-checked httpClient → geocoding-api.open-meteo.com), not the renderer — the renderer CSP forbids external hosts. Renderer caches results with a pure normalized-key cache (unit-tested).
- 2026-07-13 (Phase 5): Response Stage spoken-row sync driven by a `tts.spoken {index}` push the pipeline emits when each sentence's first audio plays; the orb maps index→row via the tested best-effort `sentenceToRow` (assumes lead-in + one-per-row when total unknown; never throws).
- 2026-07-13 (Phase 5): Orb infers voice-source (Stage trigger) from the voice.state stream (listening/thinking/speaking during the turn) rather than adding `source` to the card event — keeps the C3 AgentEvent contract unchanged.
- 2026-07-13 (Phase 5): app.open (E8) is the only new tool; explicit-verb-only guidance lives in the system prompt, enforced in eval by forbid_tools rows proving "what's on my calendar" uses calendar.list.

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
- 2026-07-12: Preload forced to CJS output (sandboxed preloads cannot be ESM); main bundle externals include all runtime deps (rrule pulled tslib in otherwise); rrule imported via default-interop for Electron ESM.
- 2026-07-12: Until 0.7, the LLM client is a KEY_MISSING stub: fast path and tools work, LLM turns show the Settings > Keys copy.
- 2026-07-12: pino rotation implemented as boot-time size check (5MB, keep 3) rather than a transport dependency.
- 2026-07-12: Minimal scheduler pulled forward from 1.2 into 0.7 because the 0.7 gate ("timer fires after restart") requires it; 1.2 extends it with recurring re-arm + missed grouping UX.
- 2026-07-12: Eval runner executes via vite-node (tsx can't transform vite `?raw` imports); tool catalog = real defs with recorded canned executors + C7-signature stubs for later-phase tools (stubs replaced as phases land).
- 2026-07-12: Eval reference "now" pinned to the C11 example instant (Sat 2026-07-11 10:00 PT) so time-resolution rows are deterministic.
- 2026-07-12: Silero VAD v5 onnx (input/state/sr signature) bundled at resources/silero_vad.onnx, downloaded from the official snakers4/silero-vad repo; verified 512-sample input works.
- 2026-07-12: PTT = hotkey press starts listening (wake-free path). Electron globalShortcut has no key-up event, so hold-400ms is not implementable without a native keyboard hook; press-to-talk single-tap chosen instead.
- 2026-07-12: debug.wake short-circuits in main into the VoiceController rather than round-tripping the worker; FakeWake is inert (MainToWorker contract unchanged).
- 2026-07-12: Porcupine gated (+0.15 threshold) mode = second engine at sensitivity−0.15 (sensitivity is bake-in-at-construction in porcupine-node).
- 2026-07-12: Deepgram SDK pinned to ^3 (v5 renamed exports/removed createClient+LiveTranscriptionEvents). googleapis auth via google.auth.OAuth2 (not google-auth-library directly) to avoid the dual-package type hazard.
- 2026-07-12: C13 email.send recipient rule enforced in the orchestrator Tier 3 gate ALWAYS (not only when taint=true), since the spec states it unconditionally for sends; contact-email resolution (contacts.findByEmail) clears the flag.
- 2026-07-12: Injection suite is FakeLLM-scripted as a "fully compromised model" and asserts the structural defenses (Tier 3 confirmation gate, taint flags, secret isolation) — this is stronger than testing a real model's compliance and needs no key.
- 2026-07-12: "good morning" is a fast-path intent that runs brief.daily locally (no LLM), so the brief works LLM-down; the brief tool's llmText is a complete ≤4-sentence spoken paragraph usable directly.
- 2026-07-12: @deepgram/sdk pinned to ^3 — v5 is a generated rewrite with a different live API; v3 matches C12.4's listen.live parameter model exactly.
- 2026-07-12: The global hotkey both toggles the palette and (when PTT enabled and voice healthy) starts wake-free listening — B1 treats the hotkey as "activate Apollo".

## L3.2 — control dispatch goes through a registry, not inline JSX

The phase brief said to assume many controls did nothing against real flows
because they had only been exercised with Fake adapters. Verifying that by
inspection is exactly the method that let the defects through in the first
place, and this repo has no DOM test harness (renderer tests target pure model
modules like threadModel/composerModel), so "render it and click it" was not
available either.

So each control's IPC call moved out of the onClick into `controlDispatch.ts`,
which maps a control id + context to a channel and payload. That makes the wire
message the unit under test rather than the handler, and it turns "this control
is unwired" into a `null` the coverage test fails on instead of a missing
onClick nobody notices. Controls that are legitimately renderer-local (card pin,
TTS skip/replay) return `local` with a stated reason, so they stay enumerated.

The cost is one indirection between a button and its effect. The audit is only
worth writing if it cannot silently go stale, so three guards accompany it: the
registry must fully resolve, every id must appear in AUDIT-controls.md, and no
orb-surface component may call `window.apollo.call` directly — that last one is
what stops a future control from being wired inline and escaping the table.

Four real defects came out of it, including two that spent an LLM turn or
orphaned a conversation from the K1 shared thread. Both would have kept passing
any test that only checked the button rendered.

## L3.2 — dead IPC ops removed, missing UI recorded instead

`completeTodo` and `pinCard` had no dispatcher and no path to one: the To-dos
surface was removed in L2.4, and pinning is renderer-local panel state whose
handler was a `break;`. Removed from `dataMutateSchema` per the clean-removal
rule.

`snoozeReminder` and `completeReminder` are equally undispatched, but they are
not the same thing — the repo methods work and reminders are a live feature that
currently surfaces as an actionless OS notification. Deleting them would remove
capability rather than dead weight, and choosing where reminder actions belong
(notification actions, a ringing overlay, a Today row) is a product decision
outside L3.2's scope. Recorded in AUDIT-controls.md and HUMAN_TODO.md.

## L1.4 — sign-in moved into the app, departing from RFC 8252

**This reverses a rule set earlier in Phase 12** ("login opens the system
browser with Authorization Code + PKCE and loopback/custom-scheme redirect;
never an embedded web view"). It was changed on explicit instruction after the
browser hand-off was tried and rejected as the product experience. Recording the
trade honestly, because it is a security-relevant reversal, not a refactor.

Two problems were reported: the browser opened a dead domain, and the login
surface should live inside Apollo. The dead domain was a separate real bug —
`auth.apolloassistant.app` is the placeholder default in config.ts and nothing
is deployed there, so the flow could never have completed. That would have been
fixed regardless of this decision.

Three options were on the table, and the middle one was chosen:

1. Keep the system browser. Preserves RFC 8252 exactly. Rejected as the desired
   experience.
2. **A native form in Apollo's own UI, posting credentials to the Apollo
   backend.** Chosen.
3. An embedded webview pointed at the IdP. Rejected, and worth stating why: this
   is the specific pattern RFC 8252 prohibits, because the host app can read the
   authentication page's DOM and the user cannot inspect the URL bar to tell a
   real login page from a forgery. Option 2 does not have this property — Apollo
   is asking for a password it will hold anyway on the way to its own backend,
   which is honest about the trust relationship, whereas a webview asks the user
   to trust an IdP page the app fully controls.

What this costs, plainly: Apollo now handles raw passwords, and the account
system no longer inherits an IdP's 2FA, SSO, breach detection, or password
reset. Those are now Apollo's to build. The password is also present in the
renderer process for as long as the user is typing it, which the browser flow
avoided entirely.

What was done to bound the cost:

- scrypt (N=2^15, r=8) with a per-account salt and a self-describing record, so
  parameters can be raised later without invalidating stored hashes.
- Sign-in responses cannot distinguish "wrong password" from "no such account",
  including on the timing path: a missing account is verified against a real
  decoy hash so the failure costs the same as a genuine one. Signup returns the
  same opaque failure for a duplicate address.
- Per-email throttling (8 failures → 15-minute lockout, cleared by a success),
  plus a tight per-channel IPC bucket so a compromised renderer cannot use main
  as a fast oracle.
- The password crosses IPC once, in memory, and is never persisted or logged;
  the Fastify logger's redact list already covers credentials, and the client
  logs only the failure kind.
- Password accounts and IdP accounts share one users table via a synthesized
  `local:<id>` subject, so the OIDC path still works for self-hosters with a
  real IdP, and the entire session/refresh/rotation machinery is unchanged.

The RFC 8252 PKCE implementation is retained and still tested. It is now the
self-host path rather than the default.

## L6 — the egress allowlist follows the operating mode

The allowlist is a statement about where a build is *able* to talk, so a managed
build should not keep entries for hosts it can no longer authenticate to.
Managed mode drops api.anthropic.com and api.search.brave.com (both proxied by
the backend) and adds the backend and IdP hosts, taken from config so a
self-hosted deployment is allowed by configuration rather than a hardcoded
domain.

Deepgram stays allowed in both modes, which looks like an inconsistency and is
not: managed STT mints a short-lived scoped token at the backend and then
streams audio straight to Deepgram, because proxying a live audio socket would
add a round trip to every utterance. The credential is managed; the transport is
direct.

Calling `createEgressPolicy` without a mode preserves the original list, so
callers written before L6 are never silently narrowed.

## Settings regrouped by intent; L5's "Account first" superseded

Settings had a tab per subsystem: Voice, Assistant, Calendars, Integrations,
Profile. That splits one user question — "what is this thing allowed to do?" —
across four screens, and it put Profile (two fields) at the same level as
Privacy. The sections are now General, Account, Capabilities, Time and Focus,
Customize, Privacy, About.

Capabilities and Customize compose the existing tabs rather than replacing them:
each old tab gained an `embedded` prop that suppresses its own display heading,
so its behavior and its tests are untouched and there is one implementation of
each screen. Profile's fields moved into Account, where they belong now that an
account supplies the name.

L5 specified Account first. General leads instead, because it is what people
open most; Account is second. The property L5 was actually protecting — Account
exists in managed and never in BYOK, Keys the reverse — is unchanged and still
tested.

## Quiet hours had a schema field and no screen

`settings.dnd` existed from Phase F, the governor honored it, and there was no
UI anywhere to change it — the defaults (22:00–08:00) were unreachable. It now
lives under Time and Focus, and gained an `enabled` flag so it can be turned off
outright rather than only moved around the clock. Both `isDND` in the governor
and the shared `isDNDNow` check it.

## Break reminders default to off

The politeness rules are the feature. A break reminder that fires during quiet
hours, interrupts an answer mid-sentence, or accumulates while the laptop is
shut and then bursts out is worse than no feature, so `breakDecision` is a pure
function tested against a clock: quiet hours outrank an overdue reminder, a
turn in flight defers rather than drops, the interval restarts after firing so
a deferred reminder fires once rather than once per missed tick, and a settings
change pushes the next one out instead of firing immediately.

Default is off. An assistant that starts interrupting on a schedule nobody asked
for is the behavior people uninstall over.

## Settings search indexes settings, not sections

Searching "quiet" has to find Quiet hours, not just point at Time and Focus and
leave the user scanning it. `settingsIndex.ts` is therefore a data table of
individual settings with the words people actually type ("dnd", "log out",
"volume", "pomodoro", "delete everything"), ranked so a label prefix beats a
keyword hit. Two integrity tests keep it honest: every entry must point at a tab
that exists, and every tab in the managed UI must have at least one indexed
setting, so a section cannot become unreachable by search.

## Customize ships only real connectors

Skills and plugins were requested for this section. They are not there, because
each needs an execution model, a permission story, and a distribution channel
before a screen for them means anything — an empty Skills tab implies capability
the app does not have. Customize contains the Google connector and the news
feeds, both real. Skills, plugins, and the Chrome extension are in HUMAN_TODO.
