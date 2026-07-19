import { z } from 'zod';
import { STRINGS, type ToolDef } from '@apollo/shared';
import { type NotesRepo } from '../db/repos/notes';
import { type UndoRepo } from '../db/repos/undo';
import { appendChecklistItem, readChecklist } from '../notes/listNote';

export interface NoteToolDeps {
  notes: NotesRepo;
  undo: UndoRepo;
}

export function createNoteTools(deps: NoteToolDeps): ToolDef[] {
  const save: ToolDef<z.ZodType<{ content: string; tags?: string[] | undefined }>> = {
    name: 'note.save',
    tier: 2,
    description: 'Save a freeform note the user wants to keep ("note that the wifi password is…"). Optional tags for grouping.',
    params: z.object({ content: z.string().min(1), tags: z.array(z.string()).optional() }),
    async execute(a, ctx) {
      const n = deps.notes.save({ content: a.content, tags: a.tags });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'note.save', data: { id: n.id } });
      return {
        llmText: `Noted: "${a.content.length > 80 ? `${a.content.slice(0, 77)}…` : a.content}"`,
        card: { kind: 'text', body: a.content },
        undoToken,
      };
    },
  };

  const search: ToolDef<z.ZodType<{ query: string }>> = {
    name: 'note.search',
    tier: 1,
    description: 'Full-text search over saved notes. Returns the top matches with highlighted snippets.',
    params: z.object({ query: z.string().min(1) }),
    async execute(a) {
      const hits = deps.notes.search(a.query, 10);
      if (hits.length === 0) return { llmText: `No notes matched "${a.query}".` };
      const lines = hits.map((h, i) => `${i + 1}. ${h.snippet}`);
      return {
        llmText: `Found ${hits.length} note${hits.length > 1 ? 's' : ''}:\n${lines.join('\n')}`,
        card: { kind: 'text', body: hits.map((h) => `• ${h.content}`).join('\n') },
      };
    },
  };

  /**
   * L4.4: the sanctioned replacement for the removed todo.* tools. "add milk to
   * my list" appends a checklist item to the designated list note, creating it
   * on first use. Tier 2 (a local, undoable write).
   */
  const appendChecklist: ToolDef<z.ZodType<{ item: string }>> = {
    name: 'note.appendChecklistItem',
    tier: 2,
    description:
      "Add an item to the user's list (\"add milk to my list\", \"put renew passport on my to-do list\"). Appends a checklist item to their list note, creating it if it does not exist. Use this instead of any to-do tool. For time-based obligations (\"remind me at 5\") use reminder.create instead.",
    params: z.object({ item: z.string().min(1) }),
    async execute(a, ctx) {
      const r = appendChecklistItem(deps.notes, a.item);
      const undoToken = deps.undo.push({
        turnId: ctx.turnId, convId: ctx.convId, tool: 'note.appendChecklistItem',
        data: { noteId: r.noteId, text: r.text, createdNote: r.created },
      });
      const items = readChecklist(deps.notes);
      return {
        llmText: STRINGS.spoken.listItemAdded(r.text),
        card: { kind: 'text', body: items.map((i) => `${i.checked ? '\u2611' : '\u2610'} ${i.text}`).join('\n') },
        undoToken,
      };
    },
  };

  /** L4.4 read-back: "what's on my list". */
  const readList: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'note.readList',
    tier: 1,
    description: "Read back the user's list (\"what's on my list\", \"what do I still need to do\"). Returns the checklist items and whether each is done.",
    params: z.object({}) as unknown as z.ZodType<Record<string, never>>,
    async execute() {
      const items = readChecklist(deps.notes);
      if (items.length === 0) return { llmText: STRINGS.spoken.listEmpty };
      const open = items.filter((i) => !i.checked);
      return {
        llmText: `${items.length} item${items.length === 1 ? '' : 's'} on the list, ${open.length} still open:\n${items
          .map((i) => `${i.checked ? '[done]' : '[open]'} ${i.text}`)
          .join('\n')}`,
        card: { kind: 'text', body: items.map((i) => `${i.checked ? '\u2611' : '\u2610'} ${i.text}`).join('\n') },
      };
    },
  };

  return [save, search, appendChecklist, readList];
}
