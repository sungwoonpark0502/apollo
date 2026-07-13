import { z } from 'zod';
import { DateTime } from 'luxon';
import { MS, type EventDTO, type OccurrenceDTO, type ToolDef } from '@apollo/shared';
import { type EventRow, type EventsRepo } from '../db/repos/events';
import { type UndoRepo } from '../db/repos/undo';
import { registerInverse } from './undo';

export interface CalendarToolDeps {
  events: EventsRepo;
  undo: UndoRepo;
}

export function toDTO(ev: EventRow): EventDTO {
  return {
    id: ev.id, title: ev.title, startTs: ev.startTs, endTs: ev.endTs, tz: ev.tz,
    allDay: ev.allDay, rrule: ev.rrule, location: ev.location, notes: ev.notes,
  };
}

function occToDTO(o: OccurrenceDTO): EventDTO {
  return {
    id: o.eventId, title: o.title, startTs: o.occStartTs, endTs: o.occEndTs, tz: o.tz,
    allDay: o.allDay, rrule: o.rrule, location: o.location, notes: o.notes,
  };
}

function fmt(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat('ccc LLL d, h:mm a');
}

const createParams = z.object({
  title: z.string().min(1),
  startIso: z.string(),
  endIso: z.string().optional(),
  tz: z.string().default('LOCAL'),
  rrule: z.string().optional(),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  reminderMin: z.number().int().min(0).optional(),
});

const updateParams = z.object({
  id: z.string(),
  scope: z.enum(['single', 'all']).default('all'),
  occurrenceDateIso: z.string().optional(),
  title: z.string().optional(),
  startIso: z.string().optional(),
  endIso: z.string().optional(),
  tz: z.string().optional(),
  rrule: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  reminderMin: z.number().int().min(0).optional(),
});

const deleteParams = z.object({
  id: z.string(),
  scope: z.enum(['single', 'all']).default('all'),
  occurrenceDateIso: z.string().optional(),
});

const listParams = z.object({
  startIso: z.string().optional(),
  endIso: z.string().optional(),
});

export function createCalendarTools(deps: CalendarToolDeps): ToolDef[] {
  // richer inverses than the defaults in tools/undo.ts
  registerInverse('calendar.update.single', (r, d) => {
    r.events.removeExdate(String(d['parentId']), String(d['dateIso']));
    r.events.softDelete(String(d['detachedId']));
    return 'restored the original occurrence';
  });
  registerInverse('calendar.delete.single', (r, d) => {
    r.events.removeExdate(String(d['parentId']), String(d['dateIso']));
    return 'restored the occurrence';
  });
  registerInverse('calendar.update', (r, d) => {
    r.events.update(String(d['id']), {
      title: String(d['title']),
      startTs: Number(d['startTs']),
      endTs: d['endTs'] === null ? null : Number(d['endTs']),
      tz: String(d['tz']),
      rrule: d['rrule'] === null ? null : String(d['rrule']),
      location: d['location'] === null ? null : String(d['location']),
      notes: d['notes'] === null ? null : String(d['notes']),
      reminderMin: d['reminderMin'] === null ? null : Number(d['reminderMin']),
    });
    return 'reverted the event to how it was';
  });

  const create: ToolDef<typeof createParams> = {
    name: 'calendar.create',
    tier: 2,
    description:
      'Create a calendar event. startIso/endIso are ISO 8601. tz "LOCAL" means the user\'s timezone. Use rrule (RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO) for recurrence. Omit endIso for a 1-hour default.',
    params: createParams,
    async execute(a, ctx) {
      const tz = a.tz === 'LOCAL' ? ctx.tz : a.tz;
      const start = DateTime.fromISO(a.startIso, { zone: tz });
      if (!start.isValid) return { llmText: 'ERROR invalid start time' };
      const end = a.endIso ? DateTime.fromISO(a.endIso, { zone: tz }) : start.plus({ hours: 1 });
      if (!end.isValid || end <= start) return { llmText: 'ERROR invalid end time' };
      const overlaps = deps.events.findOverlapping(start.toMillis(), end.toMillis());
      const ev = deps.events.create({
        title: a.title, startTs: start.toMillis(), endTs: end.toMillis(), tz,
        allDay: a.allDay, rrule: a.rrule ?? null, location: a.location ?? null,
        notes: a.notes ?? null, reminderMin: a.reminderMin ?? null,
      });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'calendar.create', data: { id: ev.id } });
      return {
        llmText:
          `Created "${ev.title}" ${start.toFormat('ccc LLL d, h:mm a')} (${tz}).` +
          (a.rrule ? ` Repeats: ${a.rrule}.` : '') +
          (overlaps.length ? ` WARNING overlaps: ${overlaps.map((o) => o.title).join(', ')}.` : '') +
          (start.toMillis() < ctx.now().getTime() && !a.rrule ? ' WARNING start time is in the past.' : ''),
        card: { kind: 'event', event: toDTO(ev) },
        undoToken,
      };
    },
  };

  const update: ToolDef<typeof updateParams> = {
    name: 'calendar.update',
    tier: 2,
    description:
      'Update an event by id (get ids from calendar.list/search). For recurring events, scope "single" edits only the occurrence at occurrenceDateIso (YYYY-MM-DD); scope "all" edits the series.',
    params: updateParams,
    async execute(a, ctx) {
      const cur = deps.events.get(a.id);
      if (!cur || cur.deletedAt) return { llmText: 'ERROR no event with that id' };
      const tz = a.tz ?? cur.tz;

      if (a.scope === 'single' && cur.rrule) {
        if (!a.occurrenceDateIso) return { llmText: 'ERROR scope "single" needs occurrenceDateIso (YYYY-MM-DD)' };
        // Write the original date to exdates and create a detached event (C7).
        const occs = deps.events.expandOccurrences(
          DateTime.fromISO(a.occurrenceDateIso, { zone: tz }).startOf('day').toMillis(),
          DateTime.fromISO(a.occurrenceDateIso, { zone: tz }).endOf('day').toMillis(),
        ).filter((o) => o.eventId === cur.id);
        const occ = occs[0];
        if (!occ) return { llmText: `ERROR no occurrence of "${cur.title}" on ${a.occurrenceDateIso}` };
        deps.events.addExdate(cur.id, a.occurrenceDateIso);
        const dur = occ.occEndTs - occ.occStartTs;
        const newStart = a.startIso ? DateTime.fromISO(a.startIso, { zone: tz }) : DateTime.fromMillis(occ.occStartTs, { zone: tz });
        if (!newStart.isValid) return { llmText: 'ERROR invalid start time' };
        const newEnd = a.endIso ? DateTime.fromISO(a.endIso, { zone: tz }) : newStart.plus({ milliseconds: dur });
        const detached = deps.events.create({
          title: a.title ?? cur.title, startTs: newStart.toMillis(), endTs: newEnd.toMillis(), tz,
          allDay: cur.allDay, rrule: null, location: a.location ?? cur.location,
          notes: a.notes ?? cur.notes, reminderMin: a.reminderMin ?? cur.reminderMin,
        });
        const undoToken = deps.undo.push({
          turnId: ctx.turnId, convId: ctx.convId, tool: 'calendar.update.single',
          data: { parentId: cur.id, dateIso: a.occurrenceDateIso, detachedId: detached.id },
        });
        return {
          llmText: `Moved the ${a.occurrenceDateIso} occurrence of "${cur.title}" to ${newStart.toFormat('ccc LLL d, h:mm a')} (${tz}). The rest of the series is unchanged.`,
          card: { kind: 'event', event: toDTO(detached) },
          undoToken,
        };
      }

      const patch: Parameters<EventsRepo['update']>[1] = {};
      if (a.title) patch.title = a.title;
      if (a.startIso) {
        const s = DateTime.fromISO(a.startIso, { zone: tz });
        if (!s.isValid) return { llmText: 'ERROR invalid start time' };
        patch.startTs = s.toMillis();
        const dur = (cur.endTs ?? cur.startTs + MS.hour) - cur.startTs;
        patch.endTs = a.endIso ? DateTime.fromISO(a.endIso, { zone: tz }).toMillis() : s.toMillis() + dur;
      } else if (a.endIso) {
        patch.endTs = DateTime.fromISO(a.endIso, { zone: tz }).toMillis();
      }
      if (a.tz) patch.tz = a.tz;
      if (a.rrule !== undefined) patch.rrule = a.rrule;
      if (a.location !== undefined) patch.location = a.location;
      if (a.notes !== undefined) patch.notes = a.notes;
      if (a.reminderMin !== undefined) patch.reminderMin = a.reminderMin;

      const before = { ...cur };
      const next = deps.events.update(a.id, patch);
      if (!next) return { llmText: 'ERROR update failed' };
      const undoToken = deps.undo.push({
        turnId: ctx.turnId, convId: ctx.convId, tool: 'calendar.update',
        data: {
          id: cur.id, title: before.title, startTs: before.startTs, endTs: before.endTs, tz: before.tz,
          rrule: before.rrule, location: before.location, notes: before.notes, reminderMin: before.reminderMin,
        },
      });
      return {
        llmText: `Updated "${next.title}" — now ${fmt(next.startTs, next.tz)} (${next.tz})${next.rrule ? `, repeats ${next.rrule}` : ''}.`,
        card: { kind: 'event', event: toDTO(next) },
        undoToken,
      };
    },
  };

  const del: ToolDef<typeof deleteParams> = {
    name: 'calendar.delete',
    tier: 2,
    description:
      'Delete an event by id (soft delete, undoable). For recurring events, scope "single" removes only the occurrence at occurrenceDateIso; scope "all" removes the series.',
    params: deleteParams,
    async execute(a, ctx) {
      const cur = deps.events.get(a.id);
      if (!cur || cur.deletedAt) return { llmText: 'ERROR no event with that id' };
      if (a.scope === 'single' && cur.rrule) {
        if (!a.occurrenceDateIso) return { llmText: 'ERROR scope "single" needs occurrenceDateIso (YYYY-MM-DD)' };
        deps.events.addExdate(cur.id, a.occurrenceDateIso);
        const undoToken = deps.undo.push({
          turnId: ctx.turnId, convId: ctx.convId, tool: 'calendar.delete.single',
          data: { parentId: cur.id, dateIso: a.occurrenceDateIso },
        });
        return { llmText: `Removed the ${a.occurrenceDateIso} occurrence of "${cur.title}". The series continues.`, undoToken };
      }
      deps.events.softDelete(cur.id);
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'calendar.delete', data: { id: cur.id } });
      return { llmText: `Deleted "${cur.title}"${cur.rrule ? ' and its whole series' : ''}.`, undoToken };
    },
  };

  const list: ToolDef<typeof listParams> = {
    name: 'calendar.list',
    tier: 1,
    description:
      'List calendar occurrences in a range (recurrences expanded, max 20). Defaults to today. Returns ids usable with calendar.update/delete.',
    params: listParams,
    async execute(a, ctx) {
      const tz = ctx.tz;
      const start = a.startIso
        ? DateTime.fromISO(a.startIso, { zone: tz })
        : DateTime.fromMillis(ctx.now().getTime(), { zone: tz }).startOf('day');
      const end = a.endIso ? DateTime.fromISO(a.endIso, { zone: tz }) : start.endOf('day');
      if (!start.isValid || !end.isValid) return { llmText: 'ERROR invalid range' };
      const occs = deps.events.expandOccurrences(start.toMillis(), end.toMillis()).slice(0, 20);
      if (occs.length === 0) return { llmText: `No events between ${start.toFormat('LLL d')} and ${end.toFormat('LLL d')}.` };
      const lines = occs.map((o, i) => `${i + 1}. ${o.title} ${fmt(o.occStartTs, o.tz)}${o.location ? ` @ ${o.location}` : ''} (id ${o.eventId})`);
      return {
        llmText: `${occs.length} event${occs.length > 1 ? 's' : ''}:\n${lines.join('\n')}`,
        card: {
          kind: 'eventList',
          title: start.hasSame(end, 'day') ? start.toFormat('cccc LLL d') : `${start.toFormat('LLL d')} – ${end.toFormat('LLL d')}`,
          events: occs.map(occToDTO),
        },
      };
    },
  };

  const search: ToolDef<z.ZodType<{ query: string }>> = {
    name: 'calendar.search',
    tier: 1,
    description: 'Search events by title, location, or notes. Returns ids usable with calendar.update/delete.',
    params: z.object({ query: z.string().min(1) }),
    async execute(a) {
      const hits = deps.events.search(a.query);
      if (hits.length === 0) return { llmText: `No events matched "${a.query}".` };
      const lines = hits.map((e, i) => `${i + 1}. ${e.title} ${fmt(e.startTs, e.tz)}${e.rrule ? ' (recurring)' : ''} (id ${e.id})`);
      return {
        llmText: lines.join('\n'),
        card: { kind: 'eventList', title: `Matches for "${a.query}"`, events: hits.map(toDTO) },
      };
    },
  };

  return [create, update, del, list, search];
}
