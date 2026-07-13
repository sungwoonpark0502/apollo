ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notes_updated ON notes(updated_at DESC) WHERE deleted_at IS NULL;

-- FTS sync triggers (0001 did not create them; the repo's manual sync is removed
-- with this migration). notes_fts is an external-content FTS5 table, so update
-- and delete must use the special 'delete'-command insert form; the direct
-- UPDATE/DELETE forms in the spec addendum are invalid SQL for FTS5 external
-- content and raise at runtime (recorded in DECISIONS.md).
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
