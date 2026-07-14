CREATE TABLE chunks(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('note','message','fact')),
  ref_id TEXT NOT NULL,               -- note id / message id / memory_fact id
  conv_id TEXT,                       -- messages only
  text TEXT NOT NULL, ts INTEGER NOT NULL,
  embedded_at INTEGER);
CREATE INDEX idx_chunks_ref ON chunks(kind, ref_id);
CREATE INDEX idx_chunks_unembedded ON chunks(embedded_at) WHERE embedded_at IS NULL;

-- Vector side, keyed by chunk_id (sqlite-vec v0.1.9 vec0 syntax; recorded in DECISIONS).
CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[384]);
