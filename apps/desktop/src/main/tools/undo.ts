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
  // L4.4: checklist items replace the removed todo.* tools. Undo either deletes
  // the note we just created, or strips the appended line back off it.
  'note.appendChecklistItem': (r, d) => {
    const noteId = String(d['noteId']);
    if (d['createdNote'] === true) {
      r.notes.softDelete(noteId);
      return 'removed the list';
    }
    const note = r.notes.get(noteId);
    if (note) {
      const lines = note.content.split('\n');
      const target = `- [ ] ${String(d['text'])}`;
      const idx = lines.lastIndexOf(target);
      if (idx !== -1) {
        lines.splice(idx, 1);
        r.notes.update(noteId, lines.join('\n'));
      }
    }
    return 'removed the list item';
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

/**
 * I3 global-undo labels: a human description of the ACTION each undoable tool
 * performed (what Cmd/Ctrl+Z would reverse), shown in the undo.recent list and
 * the undo toast. Distinct from the inverse's past-tense confirmation string.
 */
const UNDO_LABELS: Record<string, string> = {
  'timer.start': 'Started a timer',
  'alarm.set': 'Set an alarm',
  'note.save': 'Created a note',
  'note.appendChecklistItem': 'Added a list item',
  'contact.add': 'Added a contact',
  'memory.save': 'Remembered a fact',
  'memory.forget': 'Forgot a fact',
  'memory.replace': 'Updated a fact',
  'reminder.create': 'Created a reminder',
  'reminder.complete': 'Completed a reminder',
  'calendar.create': 'Created an event',
  'calendar.delete': 'Deleted an event',
  'workspace.event.update': 'Edited an event',
  'workspace.event.detach': 'Edited this occurrence',
  'workspace.event.exdate': 'Deleted this occurrence',
  'workspace.note.delete': 'Deleted a note',
};

export function undoLabel(tool: string): string {
  return UNDO_LABELS[tool] ?? 'Last action';
}

/** Register a label for a tool whose inverse is registered elsewhere (workspace UI). */
export function registerUndoLabel(tool: string, label: string): void {
  UNDO_LABELS[tool] = label;
}

export function createUndoTool(repos: Repos, opts: { onUndone?: (what: string, convId: string) => void } = {}): ToolDef {
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
      opts.onUndone?.(what, ctx.convId); // H3 audit trail
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
