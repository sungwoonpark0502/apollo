import { type CalendarCollection, type InvokeReq } from '@apollo/shared';

/**
 * I1 local calendar collections CRUD as a pure reducer over the settings-held
 * state, so it is unit-testable without settings/db. delete blocks when events
 * exist unless reassignTo is given; the last calendar and 'default' cannot be
 * removed. The handler wires eventCount/reassign/newId to the real repos.
 */
export interface CalendarsState {
  active: CalendarCollection[];
  defaultCalendarId: string;
}

export type CrudReq = InvokeReq<'calendars.crud'>;
export interface CrudResult {
  ok: boolean;
  error?: string;
  eventCount?: number;
}

export interface CrudCtx {
  eventCount: (calendarId: string) => number;
  reassign: (from: string, to: string) => void;
  newId: () => string;
}

const DEFAULT_ID = 'default';
/** L5: calendars are distinguished by name + a neutral source dot, not color. */
const NEUTRAL_COLOR = '#8A8A8A';

export function applyCalendarCrud(
  state: CalendarsState,
  req: CrudReq,
  ctx: CrudCtx,
): { state: CalendarsState; result: CrudResult } {
  const active = [...state.active];
  const find = (id: string): CalendarCollection | undefined => active.find((c) => c.id === id);

  switch (req.op) {
    case 'create': {
      // L5: no user-chosen colors. A neutral default is stored so existing
      // consumers (calendarColor, the Google source dot) keep working.
      const cal: CalendarCollection = { id: ctx.newId(), name: req.name.trim(), color: req.color ?? NEUTRAL_COLOR, kind: 'local', readOnly: false };
      return { state: { ...state, active: [...active, cal] }, result: { ok: true } };
    }
    case 'rename': {
      const cal = find(req.id);
      if (!cal) return { state, result: { ok: false, error: 'no such calendar' } };
      const next = active.map((c) => (c.id === req.id ? { ...c, name: req.name.trim() } : c));
      return { state: { ...state, active: next }, result: { ok: true } };
    }
    case 'delete': {
      const cal = find(req.id);
      if (!cal) return { state, result: { ok: false, error: 'no such calendar' } };
      if (req.id === DEFAULT_ID) return { state, result: { ok: false, error: 'cannot delete the default calendar' } };
      if (active.length <= 1) return { state, result: { ok: false, error: 'cannot delete the last calendar' } };
      const count = ctx.eventCount(req.id);
      if (count > 0 && !req.reassignTo) {
        return { state, result: { ok: false, error: 'calendar has events', eventCount: count } };
      }
      if (req.reassignTo) {
        if (req.reassignTo === req.id || !find(req.reassignTo)) {
          return { state, result: { ok: false, error: 'invalid reassign target' } };
        }
        if (count > 0) ctx.reassign(req.id, req.reassignTo);
      }
      const next = active.filter((c) => c.id !== req.id);
      const defaultCalendarId = state.defaultCalendarId === req.id ? (req.reassignTo ?? next[0]!.id) : state.defaultCalendarId;
      return { state: { active: next, defaultCalendarId }, result: { ok: true } };
    }
    case 'setDefault': {
      if (!find(req.id)) return { state, result: { ok: false, error: 'no such calendar' } };
      return { state: { ...state, defaultCalendarId: req.id }, result: { ok: true } };
    }
  }
}
