-- L4 (Phase 12): notes gain a portable ProseMirror/TipTap document. `content`
-- stays as the derived plain-text mirror that FTS, chunking/embedding, title
-- and snippet derivation already consume, so every existing consumer keeps
-- working unchanged; it is regenerated from the doc on every save.
--
-- doc NULL = "not yet converted": the app wraps the plain content on read
-- (parseDoc), which also parses the "- [ ]" lines written by the 0008 To-dos
-- migration back into real checklist items.

ALTER TABLE notes ADD COLUMN doc TEXT;
