import { z } from 'zod';
import { DateTime } from 'luxon';
import { type ToolDef } from '@apollo/shared';
import { type TodosRepo } from '../db/repos/todos';
import { type UndoRepo } from '../db/repos/undo';

export interface TodoToolDeps {
  todos: TodosRepo;
  undo: UndoRepo;
}

export function createTodoTools(deps: TodoToolDeps): ToolDef[] {
  const add: ToolDef<z.ZodType<{ content: string; dueIso?: string | undefined }>> = {
    name: 'todo.add',
    tier: 2,
    description: 'Add a todo item. Optional dueIso (ISO 8601) when the user gives a deadline.',
    params: z.object({ content: z.string().min(1), dueIso: z.string().optional() }),
    async execute(a, ctx) {
      let dueTs: number | null = null;
      if (a.dueIso) {
        const d = DateTime.fromISO(a.dueIso, { zone: ctx.tz });
        if (!d.isValid) return { llmText: 'ERROR invalid due date' };
        dueTs = d.toMillis();
      }
      const t = deps.todos.add({ content: a.content, dueTs });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'todo.add', data: { id: t.id } });
      return {
        llmText: `Added to your list: "${a.content}"${dueTs ? ` due ${DateTime.fromMillis(dueTs, { zone: ctx.tz }).toFormat('ccc LLL d')}` : ''}.`,
        undoToken,
      };
    },
  };

  const complete: ToolDef<z.ZodType<{ id?: string | undefined; content?: string | undefined }>> = {
    name: 'todo.complete',
    tier: 2,
    description:
      'Mark a todo done. Pass id when known, otherwise content for a fuzzy match. If several todos match, they are listed back instead of guessing.',
    params: z.object({ id: z.string().optional(), content: z.string().optional() }),
    async execute(a, ctx) {
      let target = a.id ? deps.todos.get(a.id) : null;
      if (!target && a.content) {
        const matches = deps.todos.fuzzyByContent(a.content);
        if (matches.length > 1) {
          return {
            llmText: `WARNING ${matches.length} todos match "${a.content}": ${matches.map((m, i) => `${i + 1}. "${m.content}"`).join('; ')}. Ask the user which one.`,
          };
        }
        target = matches[0] ?? null;
      }
      if (!target) return { llmText: `WARNING no todo matched${a.content ? ` "${a.content}"` : ''}.` };
      deps.todos.complete(target.id);
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'todo.complete', data: { id: target.id } });
      return { llmText: `Done: "${target.content}".`, undoToken };
    },
  };

  const list: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'todo.list',
    tier: 1,
    description: 'List open todos, soonest due first.',
    params: z.object({}),
    async execute(_a, ctx) {
      const open = deps.todos.listOpen();
      if (open.length === 0) return { llmText: 'The todo list is empty.' };
      const lines = open.map((t, i) => {
        const due = t.dueTs ? ` (due ${DateTime.fromMillis(t.dueTs, { zone: ctx.tz }).toFormat('ccc LLL d')})` : '';
        return `${i + 1}. ${t.content}${due}`;
      });
      return {
        llmText: `${open.length} open todo${open.length > 1 ? 's' : ''}:\n${lines.join('\n')}`,
        card: { kind: 'text', body: lines.join('\n') },
      };
    },
  };

  return [add, complete, list];
}
