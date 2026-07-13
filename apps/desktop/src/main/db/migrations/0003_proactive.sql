CREATE TABLE suggestions(
  id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK(urgency IN ('low','normal','time-sensitive')),
  payload TEXT NOT NULL,              -- SuggestionDTO JSON
  created_at INTEGER NOT NULL, shown_at INTEGER,
  outcome TEXT CHECK(outcome IN ('acted','dismissed','snoozed','expired')),
  acted_at INTEGER);
CREATE UNIQUE INDEX idx_sugg_dedupe ON suggestions(rule_id, dedupe_key);
CREATE INDEX idx_sugg_day ON suggestions(created_at);
