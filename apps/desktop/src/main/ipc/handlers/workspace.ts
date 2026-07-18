import { DateTime } from 'luxon';
import { calendarColor, type EventDTO, type InvokeReq, type InvokeRes } from '@apollo/shared';
import { type Repos, type EventRow } from '../../db/repos/index';
import { isValidRrule } from '../../db/repos/events';
import { applyUndoEntry, registerInverse, undoLabel } from '../../tools/undo';

/**
 * E1 Workspace IPC handlers. Direct UI actions are the user acting on their
 * own data: no Tier confirmation gates; destructive actions register undo_log
 * entries surfaced as undo toasts (undo.apply).
 */
export interface WorkspaceHandlerDeps {
  repos: Repos;
  tz: () => string;
  openWorkspace: (target: InvokeReq<'workspace.open'>) => void;
  /** J1.2: events created without an explicit calendar land on the configured default. */
  defaultCalendarId?: () => string;
  log: (msg: string) => void;
}

const UI_CONV = 'workspace-ui'; // undo_log scope for direct-manipulation edits

function evToDTO(ev: EventRow): EventDTO {
  return {
    id: ev.id, title: ev.title, startTs: ev.startTs, endTs: ev.endTs, tz: ev.tz,
    allDay: ev.allDay, rrule: ev.rrule, location: ev.location, notes: ev.notes,
    calendarId: ev.calendarId, color: calendarColor(ev.calendarId),
  };
}

// UI-specific inverses (tools/undo.ts owns the shared table)
registerInverse('workspace.event.update', (r, d) => {
  r.events.update(String(d['id']), d['prev'] as Partial<EventRow>);
  return 'reverted the event change';
});
registerInverse('workspace.event.detach', (r, d) => {
  r.events.removeExdate(String(d['parentId']), String(d['dateIso']));
  r.events.softDelete(String(d['detachedId']));
  return 'restored the original occurrence';
});
registerInverse('workspace.event.exdate', (r, d) => {
  r.events.removeExdate(String(d['id']), String(d['dateIso']));
  return 'restored the occurrence';
});
registerInverse('workspace.note.delete', (r, d) => {
  r.notes.restore(String(d['id']));
  return 'restored the note';
});

type PatchReq = InvokeReq<'events.update'>['patch'];

export function buildWorkspaceHandlers(deps: WorkspaceHandlerDeps) {
  const { repos } = deps;

  function resolvePatch(cur: EventRow, patch: PatchReq): Partial<EventRow> {
    const tz = patch.tz ?? cur.tz;
    const out: Partial<EventRow> = {};
    if (patch.title !== undefined) out.title = patch.title;
    if (patch.allDay !== undefined) out.allDay = patch.allDay;
    if (patch.rrule !== undefined) {
      if (patch.rrule !== null && !isValidRrule(patch.rrule)) throw new Error('invalid recurrence rule'); // J4
      out.rrule = patch.rrule;
    }
    if (patch.location !== undefined) out.location = patch.location;
    if (patch.notes !== undefined) out.notes = patch.notes;
    if (patch.reminderMin !== undefined) out.reminderMin = patch.reminderMin;
    if (patch.calendarId !== undefined) out.calendarId = patch.calendarId;
    if (patch.tz !== undefined) out.tz = patch.tz === 'LOCAL' ? deps.tz() : patch.tz;
    if (patch.startIso !== undefined) {
      const dt = DateTime.fromISO(patch.startIso, { zone: tz === 'LOCAL' ? deps.tz() : tz });
      if (!dt.isValid) throw new Error('invalid start time');
      out.startTs = dt.toMillis();
    }
    if (patch.endIso !== undefined) {
      if (patch.endIso === null) out.endTs = null;
      else {
        const dt = DateTime.fromISO(patch.endIso, { zone: tz === 'LOCAL' ? deps.tz() : tz });
        if (!dt.isValid) throw new Error('invalid end time');
        out.endTs = dt.toMillis();
      }
    }
    return out;
  }

  return {
    'workspace.open': (req: InvokeReq<'workspace.open'>): InvokeRes<'workspace.open'> => {
      deps.openWorkspace(req);
      return { ok: true as const };
    },

    'events.list': (req: InvokeReq<'events.list'>): InvokeRes<'events.list'> =>
      repos.events.expandOccurrences(req.startMs, req.endMs),

    'events.get': (req: InvokeReq<'events.get'>): InvokeRes<'events.get'> => {
      const ev = repos.events.get(req.id);
      if (!ev || ev.deletedAt) throw new Error('event not found');
      return evToDTO(ev);
    },

    'events.search': (req: InvokeReq<'events.search'>): InvokeRes<'events.search'> =>
      repos.events.search(req.query).slice(0, 8).map(evToDTO),

    'events.create': (req: InvokeReq<'events.create'>): InvokeRes<'events.create'> => {
      const tz = req.tz === 'LOCAL' ? deps.tz() : req.tz;
      const start = DateTime.fromISO(req.startIso, { zone: tz });
      if (!start.isValid) throw new Error('invalid start time');
      const end = req.endIso ? DateTime.fromISO(req.endIso, { zone: tz }) : start.plus({ hours: 1 });
      if (!end.isValid) throw new Error('invalid end time');
      if (!(req.allDay ?? false) && end <= start) throw new Error('end must be after start'); // J4 degenerate: reject end≤start
      if (req.rrule && !isValidRrule(req.rrule)) throw new Error('invalid recurrence rule'); // J4: reject malformed RRULE before persist
      const ev = repos.events.create({
        title: req.title, startTs: start.toMillis(), endTs: end.toMillis(), tz,
        allDay: req.allDay ?? false, rrule: req.rrule ?? null, location: req.location ?? null,
        notes: req.notes ?? null, reminderMin: req.reminderMin ?? null, calendarId: req.calendarId ?? deps.defaultCalendarId?.(),
      });
      repos.undo.push({ turnId: UI_CONV, convId: UI_CONV, tool: 'calendar.create', data: { id: ev.id } });
      return evToDTO(ev);
    },

    'events.update': (req: InvokeReq<'events.update'>): InvokeRes<'events.update'> => {
      const cur = repos.events.get(req.id);
      if (!cur || cur.deletedAt) throw new Error('event not found');

      if (req.scope === 'single' && cur.rrule) {
        // C7 semantics: exdate the occurrence date, create a detached event
        if (req.occStartTs === undefined) throw new Error('occStartTs required for scope single');
        const dateIso = DateTime.fromMillis(req.occStartTs, { zone: cur.tz }).toISODate();
        if (!dateIso) throw new Error('invalid occurrence');
        const resolved = resolvePatch(cur, req.patch);
        const dur = (cur.endTs ?? cur.startTs + 3_600_000) - cur.startTs;
        const startTs = resolved.startTs ?? req.occStartTs;
        repos.events.addExdate(cur.id, dateIso);
        const detached = repos.events.create({
          title: resolved.title ?? cur.title,
          startTs,
          endTs: resolved.endTs !== undefined ? resolved.endTs : startTs + dur,
          tz: resolved.tz ?? cur.tz,
          allDay: resolved.allDay ?? cur.allDay,
          rrule: null,
          location: resolved.location !== undefined ? resolved.location : cur.location,
          notes: resolved.notes !== undefined ? resolved.notes : cur.notes,
          reminderMin: resolved.reminderMin !== undefined ? resolved.reminderMin : cur.reminderMin,
          calendarId: resolved.calendarId ?? cur.calendarId,
        });
        repos.undo.push({
          turnId: UI_CONV, convId: UI_CONV, tool: 'workspace.event.detach',
          data: { parentId: cur.id, dateIso, detachedId: detached.id },
        });
        return evToDTO(detached);
      }

      const prev: Partial<EventRow> = {
        title: cur.title, startTs: cur.startTs, endTs: cur.endTs, tz: cur.tz, allDay: cur.allDay,
        rrule: cur.rrule, location: cur.location, notes: cur.notes, reminderMin: cur.reminderMin, calendarId: cur.calendarId,
      };
      const next = repos.events.update(req.id, resolvePatch(cur, req.patch));
      if (!next) throw new Error('event not found');
      repos.undo.push({ turnId: UI_CONV, convId: UI_CONV, tool: 'workspace.event.update', data: { id: cur.id, prev } });
      return evToDTO(next);
    },

    'events.delete': (req: InvokeReq<'events.delete'>): InvokeRes<'events.delete'> => {
      const cur = repos.events.get(req.id);
      if (!cur || cur.deletedAt) throw new Error('event not found');
      if (req.scope === 'single' && cur.rrule) {
        if (req.occStartTs === undefined) throw new Error('occStartTs required for scope single');
        const dateIso = DateTime.fromMillis(req.occStartTs, { zone: cur.tz }).toISODate();
        if (!dateIso) throw new Error('invalid occurrence');
        repos.events.addExdate(cur.id, dateIso);
        repos.undo.push({ turnId: UI_CONV, convId: UI_CONV, tool: 'workspace.event.exdate', data: { id: cur.id, dateIso } });
      } else {
        repos.events.softDelete(req.id);
        repos.undo.push({ turnId: UI_CONV, convId: UI_CONV, tool: 'calendar.delete', data: { id: req.id } });
      }
      return { ok: true as const };
    },

    'notes.list': (req: InvokeReq<'notes.list'>): InvokeRes<'notes.list'> =>
      repos.notes.list({ query: req.query, limit: req.limit }),

    'notes.get': (req: InvokeReq<'notes.get'>): InvokeRes<'notes.get'> => {
      const n = repos.notes.get(req.id);
      if (!n || n.deletedAt) throw new Error('note not found');
      return { id: n.id, content: n.content, pinned: n.pinned, updatedAt: n.updatedAt };
    },

    'notes.save': (req: InvokeReq<'notes.save'>): InvokeRes<'notes.save'> => {
      const n = req.id ? repos.notes.update(req.id, req.content) : repos.notes.save({ content: req.content });
      if (!n) throw new Error('note not found');
      return { id: n.id, content: n.content, pinned: n.pinned, updatedAt: n.updatedAt };
    },

    'notes.delete': (req: InvokeReq<'notes.delete'>): InvokeRes<'notes.delete'> => {
      if (!repos.notes.softDelete(req.id)) throw new Error('note not found');
      const undoToken = repos.undo.push({ turnId: UI_CONV, convId: UI_CONV, tool: 'workspace.note.delete', data: { id: req.id } });
      return { undoToken };
    },

    'notes.pin': (req: InvokeReq<'notes.pin'>): InvokeRes<'notes.pin'> => {
      repos.notes.setPinned(req.id, req.pinned);
      return { ok: true as const };
    },

    'todos.list': (): InvokeRes<'todos.list'> =>
      repos.todos.listAll().map((t) => ({ id: t.id, content: t.content, dueTs: t.dueTs, done: t.done })),

    'todos.add': (req: InvokeReq<'todos.add'>): InvokeRes<'todos.add'> => {
      const t = repos.todos.add({ content: req.content, dueTs: req.dueTs ?? null });
      return { id: t.id };
    },

    'todos.toggle': (req: InvokeReq<'todos.toggle'>): InvokeRes<'todos.toggle'> => {
      if (req.done) repos.todos.complete(req.id);
      else repos.todos.uncomplete(req.id);
      return { ok: true as const };
    },

    'todos.delete': (req: InvokeReq<'todos.delete'>): InvokeRes<'todos.delete'> => {
      repos.todos.softDelete(req.id);
      return { ok: true as const };
    },

    'undo.apply': (req: InvokeReq<'undo.apply'>): InvokeRes<'undo.apply'> => {
      const entry = repos.undo.popById(req.undoToken);
      if (!entry) throw new Error('nothing to undo');
      const what = applyUndoEntry(repos, entry);
      if (what === null) throw new Error('cannot undo this action');
      deps.log(`undo.apply: ${what}`);
      return { ok: true as const };
    },

    'undo.recent': (): InvokeRes<'undo.recent'> =>
      repos.undo.recent(10).map((e) => ({ undoToken: e.id, label: undoLabel(e.tool), ts: e.createdAt })),

    'undo.latest': (): InvokeRes<'undo.latest'> => {
      const entry = repos.undo.popNewest();
      if (!entry) return { ok: false as const };
      const label = undoLabel(entry.tool);
      const what = applyUndoEntry(repos, entry);
      if (what === null) return { ok: false as const };
      deps.log(`undo.latest: ${what}`);
      return { ok: true as const, label };
    },
  };
}
