-- I2/I7 (Phase 9): local calendar collections + Google Calendar sync fields.
-- One calendar migration lands both the calendar_id used by local categorization
-- and the remote sync columns used by the opt-in Google module (I7.3).

ALTER TABLE events ADD COLUMN calendar_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE events ADD COLUMN remote_id TEXT;
ALTER TABLE events ADD COLUMN etag TEXT;
ALTER TABLE events ADD COLUMN sync_status TEXT;

CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_remote ON events(remote_id);

-- Per-calendar incremental sync cursor (Google syncToken). Empty until connect.
CREATE TABLE sync_state(
  calendar_id TEXT PRIMARY KEY,
  sync_token TEXT,
  last_sync_ts INTEGER
);

-- Durable queue of local push operations awaiting flush (two-way sync). op is
-- create|update|delete; payload is JSON. Idempotent by op_id (I7.6).
CREATE TABLE sync_queue(
  op_id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
