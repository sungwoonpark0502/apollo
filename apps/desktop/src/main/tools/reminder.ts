import { z } from 'zod';
import { DateTime } from 'luxon';
import { type ToolDef } from '@apollo/shared';
import { type ReminderRow, type RemindersRepo } from '../db/repos/reminders';
import { type UndoRepo } from '../db/repos/undo';

export interface ReminderToolDeps {
  reminders: RemindersRepo;
  undo: UndoRepo;
  onArm?: () => void;
}

function fuzzy(pending: ReminderRow[], text: string): ReminderRow[] {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  return pending.filter((r) => {
    const t = r.text.toLowerCase();
    return tokens.every((tok) => t.includes(tok));
  });
}

function resolveTarget(
  deps: ReminderToolDeps,
  a: { id?: string | undefined; text?: string | undefined },
): { target?: ReminderRow; problem?: string } {
  if (a.id) {
    const r = deps.reminders.get(a.id);
    return r && !r.deletedAt ? { target: r } : { problem: 'WARNING no reminder with that id.' };
  }
  const pending = deps.reminders.listPending();
  if (pending.length === 0) return { problem: 'WARNING there are no pending reminders.' };
  if (!a.text) return pending.length === 1 ? { target: pending[0] } : { problem: `WARNING ${pending.length} reminders are pending; say which one.` };
  const matches = fuzzy(pending, a.text);
  if (matches.length === 0) return { problem: `WARNING no reminder matched "${a.text}".` };
  if (matches.length > 1) {
    return { problem: `WARNING ${matches.length} reminders match: ${matches.map((m, i) => `${i + 1}. "${m.text}"`).join('; ')}. Ask the user which one.` };
  }
  return { target: matches[0] };
}

export function createReminderTools(deps: ReminderToolDeps): ToolDef[] {
  const createParams = z.object({
    text: z.string().min(1),
    dueIso: z.string(),
    tz: z.string().default('LOCAL'),
    rrule: z.string().optional(),
  });

  const create: ToolDef<typeof createParams> = {
    name: 'reminder.create',
    tier: 2,
    description:
      'Create a reminder. dueIso is ISO 8601 local time; tz "LOCAL" means the user\'s timezone. Use rrule (RFC 5545) for recurring reminders ("every weekday at 9").',
    params: createParams,
    async execute(a, ctx) {
      const tz = a.tz === 'LOCAL' ? ctx.tz : a.tz;
      const due = DateTime.fromISO(a.dueIso, { zone: tz });
      if (!due.isValid) return { llmText: 'ERROR invalid due time' };
      const r = deps.reminders.create({ text: a.text, dueTs: due.toMillis(), rrule: a.rrule ?? null });
      deps.onArm?.();
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'reminder.create', data: { id: r.id } });
      return {
        llmText:
          `Reminder set: "${a.text}" at ${due.toFormat('ccc LLL d, h:mm a')} (${tz})${a.rrule ? `, repeating (${a.rrule})` : ''}.` +
          (due.toMillis() <= ctx.now().getTime() && !a.rrule ? ' WARNING that time is in the past.' : ''),
        undoToken,
      };
    },
  };

  const completeParams = z.object({ id: z.string().optional(), text: z.string().optional() });
  const complete: ToolDef<typeof completeParams> = {
    name: 'reminder.complete',
    tier: 2,
    description: 'Mark a reminder done by id or fuzzy text match. Ambiguous matches are listed back instead of guessed.',
    params: completeParams,
    async execute(a, ctx) {
      const { target, problem } = resolveTarget(deps, a);
      if (!target) return { llmText: problem ?? 'WARNING no match.' };
      deps.reminders.complete(target.id);
      deps.onArm?.();
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'reminder.complete', data: { id: target.id } });
      return { llmText: `Done: "${target.text}".`, undoToken };
    },
  };

  const snoozeParams = z.object({
    id: z.string().optional(),
    text: z.string().optional(),
    minutes: z.number().int().positive().default(10),
  });
  const snooze: ToolDef<typeof snoozeParams> = {
    name: 'reminder.snooze',
    tier: 2,
    description: 'Snooze a reminder by minutes (default 10). Target by id or fuzzy text.',
    params: snoozeParams,
    async execute(a, ctx) {
      const { target, problem } = resolveTarget(deps, a);
      if (!target) return { llmText: problem ?? 'WARNING no match.' };
      const updated = deps.reminders.snooze(target.id, a.minutes, ctx.now().getTime());
      deps.onArm?.();
      if (!updated) return { llmText: 'ERROR snooze failed' };
      return {
        llmText: `Snoozed "${target.text}" until ${DateTime.fromMillis(updated.dueTs, { zone: ctx.tz }).toFormat('h:mm a')}.`,
      };
    },
  };

  const list: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'reminder.list',
    tier: 1,
    description: 'List pending reminders, soonest first.',
    params: z.object({}),
    async execute(_a, ctx) {
      const pending = deps.reminders.listPending();
      if (pending.length === 0) return { llmText: 'No pending reminders.' };
      const lines = pending.map(
        (r, i) =>
          `${i + 1}. "${r.text}" at ${DateTime.fromMillis(r.dueTs, { zone: ctx.tz }).toFormat('ccc LLL d, h:mm a')}${r.rrule ? ' (recurring)' : ''} (id ${r.id})`,
      );
      return {
        llmText: `${pending.length} pending reminder${pending.length > 1 ? 's' : ''}:\n${lines.join('\n')}`,
        card: { kind: 'text', body: lines.map((l) => l.replace(/ \(id [^)]+\)/, '')).join('\n') },
      };
    },
  };

  return [create, complete, snooze, list];
}
