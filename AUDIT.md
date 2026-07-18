# Phase 10 Audit (Part J)

Three-pass audit-and-fix of Phases 0–9. Severity: **S1** critical (data loss / security / crash), **S2** major (contract/logic defect), **S3** minor (polish/consistency). Every finding has a disposition; every S1/S2 fix links a regression test. Nothing is "found and left."

Status legend: ✅ fixed (+test) · 🟢 verified-clean (+test) · 📋 backlogged (see BACKLOG.md) · ⏳ in progress.

## Pass A — static & contract audit (J1, J6.1, J6.2)

| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| A-J1.1-a | S3 | db/migrations | Do migrations 0001–0006 create any table/index twice, or apply non-idempotently? | 🟢 Clean. Every table/index created exactly once; migrator is guarded by `schema_version` and re-run is a no-op. Test: `db/schema.test.ts` (dup check + idempotent re-run + one row per version). |
| A-J1.1-b | S3 | db/migrate.ts | No committed source-of-truth for the fresh-DB schema. | ✅ Committed `db/schema-snapshot.json` (51 objects, v6); `schema.test.ts` asserts a fresh migrate equals it. |
| A-J1.2 | S2 | tools/calendar.ts, ipc/handlers/workspace.ts | AI `calendar.create` and UI event create hard-coded `calendar_id='default'`, ignoring a user-changed `calendars.defaultCalendarId`. | ✅ Both paths now take a `defaultCalendarId()` accessor and land new events on the configured default; color always derived via `calendarColor`. Legacy rows backfill through the `NOT NULL DEFAULT 'default'` column. Test: `tools/calendar.test.ts` (J1.2 block). |
| A-J1.3 | S2 | agent/orchestrator.ts, agent/taint.ts | Taint value-gate (C8.7) did not treat the user's OWN recalled note/fact values as user-stated, forcing a red `value_not_user_stated` flag on "email the address from my note". | ✅ Recall results of kind note/fact this turn now join the user's utterances for the substring gate; message/link/email results never clear it. Turn-scoped reset. Documented in DECISIONS.md. Tests: `orchestrator.test.ts` (note clears, web page keeps flag). |
| A-J1.4 | S3 | ipc.ts, ipc/router.ts, ipc/throttle.ts | Need proof every referenced channel is registered, frame-checked, and throttled; and that `settings.changed` is registered. | 🟢 Clean. Test `ipc/registry-completeness.test.ts` scans all source for `apollo.call/on` + `pushTo`, asserts membership, req+res schemas, a throttle bucket per invoke channel (explicit or default 300/min), and `settings.changed` present. |
| A-J6.1 | S3 | eslint.config.mjs | Formatting lint (I2) must be green repo-wide with zero suppressions. | 🟢 Clean. `pnpm lint` green; no `toLocaleTimeString/toLocaleDateString/DateTime.toFormat` outside format.ts + tests. |
| A-J6.2 | S3 | renderer components | Hardcoded user-facing literals outside strings.ts: `aria-label="Color"`, `placeholder="Paste key…"`, `aria-label="You have a nudge"`, `aria-label="Copy reply"`, `title="Copy"`. | ✅ Centralized into `STRINGS.a11y.*` / `STRINGS.settings.keys.pastePlaceholder`. Re-scan clean. Full copy inventory → strings-inventory.md (J6.4, HUMAN_TODO). |

## Pass B — dynamic & integration audit (J2–J5)

### J2 — concurrency & FSM
| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| B-J2.1 | S2 | index.ts `voiceBusy` | Proactive busy-check listed only `listening/thinking/speaking` — a nudge arriving during the **follow-up** window (or `waking`) could grab the mic mid-interaction. | ✅ Fixed: `voiceBusy = isVoiceBusy(state)` with `VOICE_BUSY_STATES = waking/listening/thinking/speaking/followup` (voice/fsmPriority.ts). Governor already defers everything (incl. time-sensitive) when busy. Tests: `fsmPriority.test.ts` + existing governor busy test. |
| B-J2.2 | S3 | (new) voice/fsmPriority.ts | FSM priority order was implicit, not encoded. | ✅ Encoded `FSM_PRIORITY = userSpeech > ringingAlarm > ttsReply > proactive` + `arbitrate` + `resolveResources` (user speech wins mic, alarm keeps visual + ducks sound, TTS ducks). Tests in `fsmPriority.test.ts`. |
| B-J2.3 | S3 | agent/confirmations.ts | Single-pending-set + supersede already correct for single→single; batch cases untested. | 🟢 Clean. Added regression tests: a new request supersedes a pending **batch** (dead batch executes nothing, `superseded` tool_result), and per-row-deny then a new request keeps one pending set. |
| B-J2.4 | S3 | renderer/orb/OrbApp.tsx | Ringing overlay vs voice/agent UI in the shared orb window could corrupt each other. | 🟢 Clean by construction: `ringing` and voice `state` are independent React slices fed by independent listeners (`alert.*` vs `voice.state`/`agent.events`), distinct channels. `resolveResources` proves both stay renderable concurrently. Live visual check → HUMAN_TODO. |

### J4 — edge cases & data integrity
| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| B-J4.1 | **S2** | memory/chunker.ts | Chunking a large single-paragraph note was **O(n²)** (repeated front-slicing + re-segmenting the whole string): a ~5MB note took ~12s, blocking the loop. | ✅ Fixed: index-based hard-split (O(n)) and `truncateGraphemes` bounds its segmentation window to `max+32` chars. 5MB note now chunks in <1s. Test: `memory/largeInput.test.ts`. |
| B-J4.2 | S2 | chunker.ts, db/repos/notes.ts | Title/snippet/chunk truncation used `.slice(0,N)` on UTF-16 units — splits surrogate pairs (emoji) and combining sequences into broken glyphs. | ✅ Fixed: new `truncateGraphemes`/`graphemeCount` (Intl.Segmenter) used for titles (80), snippets (120), and all chunk caps + the internal hard-split boundary. Tests: `text.test.ts`, `largeInput.test.ts` (emoji/CJK/RTL/ZWJ, no lone surrogate). |
| B-J4.3 | S2 | tools/calendar.ts, ipc/handlers/workspace.ts | A malformed RRULE from the custom field was persisted and only silently skipped at expansion; the UI create path also allowed `end ≤ start`. | ✅ Fixed: `isValidRrule` rejects before persist on both AI (`calendar.create`) and UI (`events.create/update`) paths; UI create rejects `end ≤ start` (AI path already did). Tests: `calendar.test.ts` degenerate block, `recurrenceCorners.test.ts`. |
| B-J4.4 | S3 | events expansion | Recurrence corner cases lacked explicit coverage. | 🟢 Added `recurrenceCorners.test.ts`: DST spring-forward/fall-back keep wall time, COUNT/UNTIL bounds, monthly-on-31st skips short months, all-day multi-day spans a month boundary. Degenerate: timer `min(1)`, note `min(1)`, recall `min(2)` already zod-enforced. |

### J3 — lifecycle & resource
| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| B-J3.1 | S2 | index.ts `powerMonitor.on('resume')` | On resume only `proactive.onResume()` ran — the **scheduler was never re-armed / caught up**, so timers/reminders/alarms due during a long suspend fired late (or at the stale monotonic delay). | ✅ Fixed: resume now calls `scheduler.catchUp()` (fire missed grouped + re-arm) and `gcal.onFocus()`. Test: `scheduler.test.ts` resume-storm (timer+reminder+alarm fire once). |
| B-J3.2 | S2 | scheduler.ts | Wall-clock jump: one `setTimeout` armed to the next due; a manual clock change or drift could strand an overdue item (no periodic recheck). | ✅ Fixed: a 60s **sanity interval** recomputes remaining delay from the stored absolute targets; overdue fire immediately (grouped). Tests: forward jump fires within one tick, backward jump doesn't fire early and still fires at the absolute target. |
| B-J3.3 | S2 | index.ts indexer `canDrain` | Indexer drained only when `state === 'idle'` — never while `muted` (mic off, indexing is safe), starving the index whenever muted. | ✅ Fixed (10.2): `canDrainIndex(state)` = idle∨muted, never listening/thinking/speaking/followup. Test in `fsmPriority.test.ts`. |
| B-J3.4 | S3 | voice/workerHost.ts | Worker lifecycle (crash-restart backoff, 3-strike disable, healthy-reset) was correct but untestable — it called Electron `utilityProcess`/`setTimeout` directly. | ✅ Injected `fork`/`setTimer`; added the lifecycle matrix test (lazy spawn, crash→backoff→respawn ×3→disable, noteHealthy reset, stop suppresses respawn). |
| B-J3.5 | **S1** | tools/registry.ts, memory/indexer.ts, errors.ts | A DB write hitting `SQLITE_FULL`/`SQLITE_IOERR` was swallowed by `registry.execute` into a recoverable `ERROR …` tool result (leaking the raw SQLite message to the LLM) and the indexer only logged it — no honest user-facing failure state. | ✅ Fixed: new `DISK_FULL` ErrorCode + copy ("I can't save right now, your disk may be full…"); `isDiskFullError`/`toErrorCode` detect it centrally; `registry.execute` re-throws `AppError('DISK_FULL')` so the turn reports it honestly; the indexer backs off 30s and retries with chunks left pending (no crash, no loss). Tests: `db/diskFull.test.ts` + indexer backoff test. |

### J5 — security re-audit
| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| B-J5.1 | **S1** | net/linkReader.ts | DNS rebinding: the SSRF guard resolved+validated once, then `net.fetch` re-resolved independently — a host rebinding public→private between check and connect could reach a private address. | ✅ Fixed: connect-time re-validation — `assertPublicUrl` runs immediately before **every** connect (initial + each redirect hop), so a public→private rebind is rejected before any request. Test: `linkReader.test.ts` (rebinding resolver, fetch never called). Residual (net.fetch owns the socket DNS, no IP pin possible w/o breaking TLS SNI) documented in DECISIONS; mitigated by 5s timeout + tier-1 read-only + untrusted-wrapped result. |
| B-J5.2 | S2 | data/exportImport.ts | Export secret-exclusion proof only checked API keys — didn't explicitly assert gcal tokens / oauth rows absent. | 🟢 Strengthened: seed a Google oauth row + gcal sync token; assert no ciphertext/token/`token_ref`/`sync_token` in any zip entry, and the export set excludes oauth_accounts/sync_state/usage_log. usage_log = aggregate telemetry, never exported (documented). |
| B-J5.3 | S2 | ipc/router.ts | No fuzz over the full IPC surface. | 🟢 `ipc/fuzz.test.ts`: every channel rejects malformed/oversized payloads with `invalid_payload` (handler never runs); throttle drops on burst. Pairs with J1.4 registry completeness. |
| B-J5.4 | S3 | net/egressCanary.test.ts | Egress lane integrity across subsystems. | 🟢 Clean. Canary asserts observed hosts ⊆ allowlist, the user-link lane is constructed only in index.ts and imported only by index.ts + tools/link.ts; gcal's raw fetch is egress-guarded (www.googleapis.com only). |
| B-J5.5 | S3 | scripts/fuses.* , security/permissions.ts | Fuse config + permission lockdown re-verification. | 🟢 Config/logic tests green (`fuses.test.ts`, permissions/injection suites). Packaged-binary fuse **readback** + permission-denial on the built app + cross-platform installable artifacts → HUMAN_TODO (needs electron-builder on macOS + Windows CI). |

## Pass C — regression lock & docs (J6.3–J6.5)
| id | sev | location | finding | disposition |
|----|-----|----------|---------|-------------|
| C-J6.3 | S3 | agent/orchestrator.ts `errorCopy` | `errorCopy('CANCELED')` fell through to the INTERNAL copy — a user cancel could show "Something went wrong". | ✅ Added the CANCELED case (empty copy). Coverage test `errorTaxonomy.test.ts`: every ErrorCode maps to non-empty user copy (except CANCELED), no raw token/`[object`/`SQLITE_` leak. |
| C-J6.4 | S3 | strings.ts | No generated copy inventory for the tone review. | 🟢 Generated `strings-inventory.md` (477 strings). Subjective C10/C18 tone pass → HUMAN_TODO. |
| C-J6.5 | S3 | renderer | Accessibility spot audit. | 🟢 Interactive-surface + screen-reader checklist → HUMAN_TODO. |
| C-regress | — | whole repo | Lock every A/B fix + re-run all phases. | ✅ Regression tests added for every A/B fix (linked above). Full cross-phase suite green; docs (README/PROGRESS/DECISIONS/HUMAN_TODO/AUDIT/BACKLOG) reconciled. |

**Open S1/S2:** none. All S1 (disk-full, DNS-rebinding) and S2 (calendar default, taint ergonomics, resume/wall-clock, indexer gating, chunker O(n²), unicode truncation, RRULE validation, export completeness, IPC fuzz) fixed with regression tests. S3s fixed inline or backlogged.
