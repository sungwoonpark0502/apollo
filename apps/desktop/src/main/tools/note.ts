import { z } from 'zod';
import { type ToolDef } from '@apollo/shared';
import { type NotesRepo } from '../db/repos/notes';
import { type UndoRepo } from '../db/repos/undo';

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

  return [save, search];
}
