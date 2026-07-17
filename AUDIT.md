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
_populated during 10.2–10.5_

## Pass C — regression lock & docs (J6.3)
_populated during 10.6_
