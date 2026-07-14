CREATE TABLE action_log(
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, tool TEXT NOT NULL,
  summary TEXT NOT NULL, outcome TEXT NOT NULL
    CHECK(outcome IN ('executed','canceled','denied','expired','undone')),
  conv_id TEXT);
CREATE INDEX idx_action_ts ON action_log(ts DESC);
CREATE TABLE usage_log(
  day TEXT NOT NULL, provider TEXT NOT NULL, metric TEXT NOT NULL,
  amount REAL NOT NULL, PRIMARY KEY(day, provider, metric));
CREATE INDEX idx_conv_started ON conversations(started_at DESC);
