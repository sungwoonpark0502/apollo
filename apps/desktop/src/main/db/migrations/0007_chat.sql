-- PART K (Phase 11): the Chat tab's conversation sidebar supports Rename and
-- Pin (K2). title NULL = derive from the first user message as before.

ALTER TABLE conversations ADD COLUMN title TEXT;
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
