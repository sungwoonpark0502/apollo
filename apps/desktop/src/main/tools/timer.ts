import { z } from 'zod';
import { DateTime } from 'luxon';
import { MS, STRINGS, type ToolDef } from '@apollo/shared';
import { type TimersRepo } from '../db/repos/timers';
import { type UndoRepo } from '../db/repos/undo';

export interface TimerToolDeps {
  timers: TimersRepo;
  undo: UndoRepo;
  onArm?: () => void; // scheduler re-arm hook
}

function describeDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ') || '0 seconds';
}

export function createTimerTools(deps: TimerToolDeps): ToolDef[] {
  const start: ToolDef<z.ZodType<{ durationSec: number; label?: string | undefined }>> = {
    name: 'timer.start',
    tier: 2,
    description:
      'Start a countdown timer. durationSec is the total duration in seconds (e.g. 300 for 5 minutes). Optional label names the timer ("pasta"). Multiple timers can run at once.',
    params: z.object({
      durationSec: z.number().int().min(1).max(60 * 60 * 24),
      label: z.string().min(1).optional(),
    }),
    async execute(a, ctx) {
      const endsAt = ctx.now().getTime() + a.durationSec * MS.second;
      const t = deps.timers.start({ label: a.label ?? null, endsAt });
      deps.onArm?.();
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'timer.start', data: { id: t.id } });
      return {
        llmText: `Timer set for ${describeDuration(a.durationSec)}${a.label ? ` labeled "${a.label}"` : ''}.`,
        card: { kind: 'timer', id: t.id, label: t.label, endsAt: t.endsAt },
        undoToken,
      };
    },
  };

  const cancel: ToolDef<z.ZodType<{ id?: string | undefined; label?: string | undefined }>> = {
    name: 'timer.cancel',
    tier: 2,
    description:
      'Cancel a running timer by id, by label, or the soonest-ending one when neither is given.',
    params: z.object({ id: z.string().optional(), label: z.string().optional() }),
    async execute(a, ctx) {
      const active = deps.timers.listActive();
      if (active.length === 0) return { llmText: 'WARNING no timers are running.' };
      let target = a.id
        ? active.find((t) => t.id === a.id)
        : a.label
          ? active.find((t) => t.label?.toLowerCase().includes(a.label!.toLowerCase()))
          : active[0];
      if (!target && a.label && active.length === 1) target = active[0];
      if (!target) return { llmText: `WARNING no timer matched. Active: ${active.map((t) => t.label ?? describeRemaining(t.endsAt, ctx.now())).join(', ')}.` };
      deps.timers.cancel(target.id);
      deps.onArm?.();
      return { llmText: `${STRINGS.spoken.timerCanceled}${target.label ? ` ("${target.label}")` : ''}` };
    },
  };

  const list: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'timer.list',
    tier: 1,
    description: 'List running timers with remaining time.',
    params: z.object({}),
    async execute(_a, ctx) {
      const active = deps.timers.listActive();
      if (active.length === 0) return { llmText: 'No timers are running.' };
      const now = ctx.now();
      const lines = active.map(
        (t, i) => `${i + 1}. ${t.label ? `"${t.label}" ` : ''}${describeRemaining(t.endsAt, now)} remaining`,
      );
      const first = active[0]!;
      return {
        llmText: `${active.length} timer${active.length > 1 ? 's' : ''} running: ${lines.join('; ')}.`,
        card: { kind: 'timer', id: first.id, label: first.label, endsAt: first.endsAt },
      };
    },
  };

  return [start, cancel, list];
}

function describeRemaining(endsAt: number, now: Date): string {
  const remaining = Math.max(0, Math.round((endsAt - now.getTime()) / 1000));
  return describeDuration(remaining);
}

export function nextTimerLabel(endsAt: number, tz: string): string {
  return DateTime.fromMillis(endsAt, { zone: tz }).toFormat('h:mm a');
}
