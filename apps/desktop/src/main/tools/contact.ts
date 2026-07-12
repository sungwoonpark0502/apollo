import { z } from 'zod';
import { type ToolDef } from '@apollo/shared';
import { type ContactsRepo } from '../db/repos/contacts';
import { type UndoRepo } from '../db/repos/undo';

export interface ContactToolDeps {
  contacts: ContactsRepo;
  undo: UndoRepo;
}

export function createContactTools(deps: ContactToolDeps): ToolDef[] {
  const add: ToolDef<z.ZodType<{ name: string; email?: string | undefined }>> = {
    name: 'contact.add',
    tier: 2,
    description: 'Save a contact (name, optional email). Used later to resolve email recipients by name.',
    params: z.object({ name: z.string().min(1), email: z.string().email().optional() }),
    async execute(a, ctx) {
      const c = deps.contacts.add({ name: a.name, email: a.email ?? null });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'contact.add', data: { id: c.id } });
      return { llmText: `Saved contact ${a.name}${a.email ? ` <${a.email}>` : ''}.`, undoToken };
    },
  };

  const find: ToolDef<z.ZodType<{ name: string }>> = {
    name: 'contact.find',
    tier: 1,
    description: 'Find contacts by (fuzzy) name. Returns matches with emails; use it to resolve a recipient before drafting an email.',
    params: z.object({ name: z.string().min(1) }),
    async execute(a) {
      const hits = deps.contacts.find(a.name);
      if (hits.length === 0) return { llmText: `No contact matched "${a.name}".` };
      return {
        llmText: hits
          .slice(0, 5)
          .map((c) => `${c.name}${c.email ? ` <${c.email}>` : ' (no email)'}`)
          .join('; '),
      };
    },
  };

  return [add, find];
}
