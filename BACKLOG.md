# Backlog

Deferred S3 findings and desirable features surfaced during audits. Per Part J scope discipline (A3), features discovered during Phase 10 are logged here and NOT built.

## Deferred S3 (from Phase 10 audit)
_none yet — all Pass A S3 findings were fixed inline._

## Features surfaced (not built — scope discipline)
- **Editor cross-boundary move UI (I7)**: the atomic local↔synced move exists and is tested in the gcal engine (`moveEvent`), but the event editor's calendar picker only changes `calendar_id`. Wiring the picker to call the engine move for two-way calendars is a feature, not a defect.
- **Warmer empty-state copy (I6)**: Today/Calendar/Notes/Chats empty states are functional but could get the richer one-liners the spec sketches. Copy polish, deferred.
