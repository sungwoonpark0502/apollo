CREATE TABLE events(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER,
  tz TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, rrule TEXT, exdates TEXT,
  location TEXT, notes TEXT, reminder_min INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE reminders(
  id TEXT PRIMARY KEY, text TEXT NOT NULL, due_ts INTEGER NOT NULL, rrule TEXT,
  fired_at INTEGER, done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE timers(
  id TEXT PRIMARY KEY, label TEXT, ends_at INTEGER NOT NULL,
  canceled INTEGER NOT NULL DEFAULT 0, fired_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE alarms(
  id TEXT PRIMARY KEY, label TEXT, at_ts INTEGER NOT NULL, rrule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, fired_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE notes(
  id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE VIRTUAL TABLE notes_fts USING fts5(content, content='notes', content_rowid='rowid');
CREATE TABLE todos(
  id TEXT PRIMARY KEY, content TEXT NOT NULL, due_ts INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE contacts(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE conversations(id TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
CREATE TABLE messages(
  id TEXT PRIMARY KEY, conv_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')), content TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE memory_facts(
  id TEXT PRIMARY KEY, category TEXT NOT NULL, fact TEXT NOT NULL,
  source_conv_id TEXT, confidence REAL NOT NULL DEFAULT 0.8,
  updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE oauth_accounts(id TEXT PRIMARY KEY, provider TEXT NOT NULL, address TEXT, token_ref TEXT NOT NULL);
CREATE TABLE capability_misses(id TEXT PRIMARY KEY, utterance TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE feeds(id TEXT PRIMARY KEY, url TEXT NOT NULL, category TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE perf_spans(id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, name TEXT NOT NULL, dur_ms INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE undo_log(id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, tool TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_events_start  ON events(start_ts)  WHERE deleted_at IS NULL;
CREATE INDEX idx_reminders_due ON reminders(due_ts) WHERE fired_at IS NULL AND done=0 AND deleted_at IS NULL;
CREATE INDEX idx_timers_active ON timers(ends_at)   WHERE canceled=0 AND fired_at IS NULL;
CREATE INDEX idx_alarms_next   ON alarms(at_ts)     WHERE enabled=1 AND deleted_at IS NULL;
CREATE INDEX idx_messages_conv ON messages(conv_id, ts);
CREATE INDEX idx_memory_cat    ON memory_facts(category) WHERE deleted_at IS NULL;
