import { z } from 'zod';
import { DateTime } from 'luxon';
import { type ToolDef } from '@apollo/shared';
import { type AlarmsRepo } from '../db/repos/alarms';
import { type UndoRepo } from '../db/repos/undo';

export interface AlarmToolDeps {
  alarms: AlarmsRepo;
  undo: UndoRepo;
  onArm?: () => void;
}

const alarmParams = z.object({
  atIso: z.string(),
  tz: z.string().default('LOCAL'),
  label: z.string().optional(),
  rrule: z.string().optional(),
});

export function createAlarmTools(deps: AlarmToolDeps): ToolDef[] {
  const set: ToolDef<typeof alarmParams> = {
    name: 'alarm.set',
    tier: 2,
    description:
      'Set an alarm. atIso is ISO 8601 local time; tz "LOCAL" means the user\'s timezone. Use rrule (RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR) for repeating alarms like weekday mornings.',
    params: alarmParams,
    async execute(a, ctx) {
      const tz = a.tz === 'LOCAL' ? ctx.tz : a.tz;
      const at = DateTime.fromISO(a.atIso, { zone: tz });
      if (!at.isValid) return { llmText: 'ERROR invalid alarm time' };
      const past = at.toMillis() <= ctx.now().getTime() && !a.rrule;
      const alarm = deps.alarms.set({ label: a.label ?? null, atTs: at.toMillis(), rrule: a.rrule ?? null });
      deps.onArm?.();
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'alarm.set', data: { id: alarm.id } });
      return {
        llmText:
          `Alarm set for ${at.toFormat('ccc LLL d, h:mm a')} (${tz})${a.rrule ? `, repeating (${a.rrule})` : ''}.` +
          (past ? ' WARNING that time is in the past.' : ''),
        undoToken,
      };
    },
  };
  return [set];
}
