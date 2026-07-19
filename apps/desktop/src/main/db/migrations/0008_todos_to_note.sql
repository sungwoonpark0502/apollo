-- L2 (Phase 12): To-dos are removed as a first-class surface. Existing rows
-- migrate losslessly into a single checklist note titled "To-dos", preserving
-- each item's checked state as a Markdown task line ("- [x]" / "- [ ]").
-- 12.5's notes-doc migration parses those lines back into real checklist items.
--
-- Non-destructive by design: the todos tables are retained (unused) so an
-- upgrade can never lose data; a later cleanup drops them.

INSERT INTO notes (id, content, tags, created_at, updated_at, deleted_at)
SELECT
  'note-todos-migrated',
  'To-dos' || char(10) || group_concat(
    CASE WHEN done = 1 THEN '- [x] ' ELSE '- [ ] ' END || content,
    char(10)
  ),
  NULL,
  COALESCE(MIN(created_at), CAST(strftime('%s','now') AS INTEGER) * 1000),
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  NULL
FROM (SELECT content, done, created_at FROM todos WHERE deleted_at IS NULL ORDER BY done, created_at)
HAVING COUNT(*) > 0;

-- Keep FTS in step with the note we just inserted (notes_fts is external-content).
INSERT INTO notes_fts (rowid, content)
SELECT rowid, content FROM notes WHERE id = 'note-todos-migrated';
