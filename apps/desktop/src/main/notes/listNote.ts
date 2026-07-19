import { type NotesRepo } from '../db/repos/notes';

/**
 * L2/L4.4: checklists replace the removed To-dos surface. "add X to my list"
 * appends a Markdown task line to a designated list note, creating it if it
 * does not exist. Plain-text task lines are the storage format; 12.5's notes
 * doc migration parses them back into real checklist items, so this stays the
 * single append path for both Quick Capture and the note.appendChecklistItem
 * tool.
 */
export const LIST_NOTE_TITLE = 'To-dos';

/** Markdown task lines, as produced by the 0008 migration and by appends. */
const TASK_LINE = /^\s*-\s*\[([ xX])\]\s*(.*)$/;

export function isTaskLine(line: string): boolean {
  return TASK_LINE.test(line);
}

export function parseTaskLine(line: string): { checked: boolean; text: string } | null {
  const m = TASK_LINE.exec(line);
  return m ? { checked: m[1]!.toLowerCase() === 'x', text: m[2]!.trim() } : null;
}

export function formatTaskLine(text: string, checked = false): string {
  return `- [${checked ? 'x' : ' '}] ${text}`;
}

/** The note that acts as the user's list: first note whose title matches. */
export function findListNote(notes: NotesRepo): { id: string; content: string } | null {
  for (const n of notes.list({ limit: 200 })) {
    if (n.title.trim().toLowerCase() === LIST_NOTE_TITLE.toLowerCase()) {
      const full = notes.get(n.id);
      if (full && !full.deletedAt) return { id: full.id, content: full.content };
    }
  }
  return null;
}

/**
 * Appends one checklist item to the list note, creating the note when absent.
 * Returns the note id and the appended text.
 */
export function appendChecklistItem(notes: NotesRepo, text: string): { noteId: string; text: string; created: boolean } {
  const item = text.trim();
  if (!item) throw new Error('empty checklist item');
  const existing = findListNote(notes);
  if (!existing) {
    const created = notes.save({ content: `${LIST_NOTE_TITLE}\n${formatTaskLine(item)}` });
    return { noteId: created.id, text: item, created: true };
  }
  const next = `${existing.content.replace(/\s+$/, '')}\n${formatTaskLine(item)}`;
  notes.update(existing.id, next);
  return { noteId: existing.id, text: item, created: false };
}

/** Open (unchecked) items on the list note, for "what's on my list". */
export function readChecklist(notes: NotesRepo): Array<{ checked: boolean; text: string }> {
  const note = findListNote(notes);
  if (!note) return [];
  return note.content
    .split('\n')
    .map(parseTaskLine)
    .filter((x): x is { checked: boolean; text: string } => x !== null);
}
