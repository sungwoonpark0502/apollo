import { z } from 'zod';
import { STRINGS, type ToolDef } from '@apollo/shared';
import { type Repos } from '../db/repos/index';

/**
 * undo.last pops the newest undo_log entry for this conversation and executes
 * the inverse operation. Each undoable tool registers its inverse here.
 */
type InverseFn = (repos: Repos, data: Record<string, unknown>) => string; // returns human description

const INVERSES: Record<string, InverseFn> = {
  'timer.start': (r, d) => {
    r.timers.cancel(String(d['id']));
    return 'canceled the timer';
  },
  'alarm.set': (r, d) => {
    r.alarms.softDelete(String(d['id']));
    return 'removed the alarm';
  },
  'note.save': (r, d) => {
    r.notes.softDelete(String(d['id']));
    return 'deleted the note';
  },
  'todo.add': (r, d) => {
    r.todos.softDelete(String(d['id']));
    return 'removed the todo';
  },
  'todo.complete': (r, d) => {
    r.todos.uncomplete(String(d['id']));
    return 'reopened the todo';
  },
  'contact.add': (r, d) => {
    r.contacts.softDelete(String(d['id']));
    return 'removed the contact';
  },
  'memory.save': (r, d) => {
    r.memory.delete(String(d['id']));
    return 'forgot the fact again';
  },
  'memory.forget': (r, d) => {
    r.memory.restore(String(d['id']));
    return 'restored the remembered fact';
  },
  'memory.replace': (r, d) => {
    // G5 contradiction handling: undo removes the new fact and restores the old.
    r.memory.delete(String(d['newId']));
    r.memory.restore(String(d['oldId']));
    return 'restored what I knew before';
  },
  'reminder.create': (r, d) => {
    r.reminders.softDelete(String(d['id']));
    return 'removed the reminder';
  },
  'reminder.complete': (r, d) => {
    r.reminders.uncomplete(String(d['id']));
    return 'reopened the reminder';
  },
  'calendar.create': (r, d) => {
    r.events.softDelete(String(d['id']));
    return 'removed the event';
  },
  'calendar.delete': (r, d) => {
    r.events.restore(String(d['id']));
    return 'restored the event';
  },
};

export function createUndoTool(repos: Repos): ToolDef {
  const undoLast: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'undo.last',
    tier: 2,
    description: 'Undo the most recent undoable action in this conversation (created events, notes, todos, timers, remembered facts…).',
    params: z.object({}),
    async execute(_a, ctx) {
      const entry = repos.undo.popLatest(ctx.convId);
      if (!entry) return { llmText: STRINGS.spoken.nothingToUndo };
      const inverse = INVERSES[entry.tool];
      if (!inverse) return { llmText: `WARNING I don't know how to undo ${entry.tool}.` };
      const what = inverse(repos, entry.data);
      return { llmText: STRINGS.spoken.undone(what) };
    },
  };
  return undoLast;
}

/** Exposed so calendar.update-style tools can register richer inverses later. */
export function registerInverse(tool: string, fn: InverseFn): void {
  INVERSES[tool] = fn;
}

/** E1 undo.apply: executes the inverse of a specific undo entry (UI undo toasts). */
export function applyUndoEntry(repos: Repos, entry: { tool: string; data: Record<string, unknown> }): string | null {
  const inverse = INVERSES[entry.tool];
  if (!inverse) return null;
  return inverse(repos, entry.data);
}
