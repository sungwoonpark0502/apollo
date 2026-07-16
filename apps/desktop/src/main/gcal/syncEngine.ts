import { newId } from '@apollo/shared';
import { type EventsRepo, type EventRow } from '../db/repos/events';
import { type SyncRepo } from '../db/repos/sync';
import { gEventToInput, remoteCalendarId, rowToGEvent } from './mapping';
import { GEtagError, type GoogleCalendarClient } from './types';

/**
 * I7 sync engine: incremental pull (Google syncToken; full resync on 410),
 * two-way push with etag preconditions, conflict capture, cross-boundary move,
 * and disconnect. All Google access goes through the injected client, so the
 * whole engine is unit-testable with a mock (no real account, no network).
 */
export interface ConflictInfo {
  eventId: string;
  calendarId: string;
  local: { title: string; startTs: number };
  remote: { title: string; startTs: number };
}

export interface SyncEngineDeps {
  client: GoogleCalendarClient;
  events: EventsRepo;
  sync: SyncRepo;
  syncedCalendars: () => string[]; // local collection ids ("google:<id>")
  directionOf: (collectionId: string) => 'read-only' | 'two-way';
  now: () => number;
  onConflict?: (c: ConflictInfo) => void;
  log?: (m: string) => void;
}

export function createSyncEngine(deps: SyncEngineDeps) {
  // Captured local snapshots for events currently in conflict (mine vs theirs).
  const conflicts = new Map<string, { snapshot: EventRow; info: ConflictInfo }>();

  async function pull(collectionId: string): Promise<number> {
    const remoteId = remoteCalendarId(collectionId);
    const token = deps.sync.getToken(collectionId);
    let page = await deps.client.listEvents(remoteId, { syncToken: token });
    if (page.gone) {
      deps.sync.clearToken(collectionId); // 410 GONE → drop token, full resync
      page = await deps.client.listEvents(remoteId, { syncToken: null });
    }
    let changed = 0;
    for (const g of page.items) {
      const existing = deps.events.getByRemoteId(g.id);
      if (g.status === 'cancelled') {
        if (existing) {
          deps.events.softDelete(existing.id); // deletion tombstoned locally
          changed++;
        }
        continue;
      }
      const input = gEventToInput(g, collectionId);
      if (!input) continue;
      if (existing) {
        deps.events.update(existing.id, input);
        deps.events.replaceExdates(existing.id, input.exdates);
      } else {
        const row = deps.events.create(input);
        deps.events.replaceExdates(row.id, input.exdates);
      }
      changed++;
    }
    if (page.nextSyncToken) deps.sync.setToken(collectionId, page.nextSyncToken, deps.now());
    return changed;
  }

  async function push(collectionId: string): Promise<number> {
    if (deps.directionOf(collectionId) !== 'two-way') return 0;
    const remoteId = remoteCalendarId(collectionId);
    let changed = 0;
    for (const op of deps.sync.pending(collectionId)) {
      try {
        if (op.op === 'create') {
          const row = deps.events.get(op.eventId);
          if (!row || row.deletedAt) { deps.sync.dequeue(op.opId); continue; }
          const g = await deps.client.insertEvent(remoteId, { ...rowToGEvent(row), id: idempotentId(op.opId) });
          deps.events.update(op.eventId, { remoteId: g.id, etag: g.etag, syncStatus: 'synced', calendarId: collectionId });
        } else if (op.op === 'update') {
          const row = deps.events.get(op.eventId);
          if (!row || !row.remoteId || !row.etag) { deps.sync.dequeue(op.opId); continue; }
          const g = await deps.client.patchEvent(remoteId, row.remoteId, rowToGEvent(row), row.etag);
          deps.events.update(op.eventId, { etag: g.etag, syncStatus: 'synced' });
        } else {
          const payload = op.payload as { remoteId?: string; etag?: string } | null;
          if (payload?.remoteId && payload.etag) await deps.client.deleteEvent(remoteId, payload.remoteId, payload.etag);
        }
        deps.sync.dequeue(op.opId);
        changed++;
      } catch (e) {
        if (e instanceof GEtagError) {
          // Never silently overwrite: capture local, re-pull the remote, raise a conflict.
          const snapshot = deps.events.get(op.eventId);
          await pull(collectionId);
          const remote = deps.events.get(op.eventId);
          if (snapshot && remote) {
            const info: ConflictInfo = {
              eventId: op.eventId,
              calendarId: collectionId,
              local: { title: snapshot.title, startTs: snapshot.startTs },
              remote: { title: remote.title, startTs: remote.startTs },
            };
            conflicts.set(op.eventId, { snapshot, info });
            deps.onConflict?.(info);
          }
          deps.sync.dequeue(op.opId); // resolution re-enqueues as needed
        } else {
          // Network/transient: leave the op queued so it flushes on reconnect.
          deps.log?.(`push deferred for ${op.eventId}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }
    return changed;
  }

  return {
    pull,
    push,

    /** Pull then (two-way) push a single synced calendar. */
    async runSync(collectionId: string): Promise<number> {
      const changed = await pull(collectionId);
      return changed + (await push(collectionId));
    },

    /** Pull+push every synced calendar; returns total changed. */
    async runAll(): Promise<number> {
      let changed = 0;
      for (const c of deps.syncedCalendars()) {
        changed += await pull(c);
        changed += await push(c);
      }
      return changed;
    },

    pendingConflicts(): ConflictInfo[] {
      return [...conflicts.values()].map((c) => c.info);
    },

    /** Resolve a captured conflict: keep local (re-push), keep remote (no-op), or keep both. */
    resolveConflict(eventId: string, choice: 'mine' | 'theirs' | 'both'): void {
      const entry = conflicts.get(eventId);
      if (!entry) return;
      const { snapshot } = entry;
      if (choice === 'theirs') {
        // remote already applied by the re-pull; nothing to do.
      } else if (choice === 'mine') {
        deps.events.update(eventId, { title: snapshot.title, startTs: snapshot.startTs, endTs: snapshot.endTs, syncStatus: 'local-dirty' });
        deps.sync.enqueue({ opId: newId(), calendarId: entry.info.calendarId, eventId, op: 'update', payload: null, createdAt: deps.now() });
      } else {
        // keep both: remote stays as the synced event; local copy becomes a new local-only event.
        deps.events.create({
          title: snapshot.title, startTs: snapshot.startTs, endTs: snapshot.endTs, tz: snapshot.tz,
          allDay: snapshot.allDay, rrule: snapshot.rrule, location: snapshot.location, notes: snapshot.notes,
          calendarId: 'default',
        });
      }
      conflicts.delete(eventId);
    },

    /**
     * Move an event across the local/synced boundary atomically: delete-here +
     * create-there. Moving onto a two-way synced calendar queues a remote create;
     * moving off one queues a remote delete of the old remote copy.
     */
    moveEvent(eventId: string, toCalendarId: string): void {
      const row = deps.events.get(eventId);
      if (!row || row.deletedAt) return;
      const from = row.calendarId;
      if (from === toCalendarId) return;
      // Queue removal of the old remote copy if it lived on a two-way synced calendar.
      if (row.remoteId && row.etag && deps.directionOf(from) === 'two-way') {
        deps.sync.enqueue({ opId: newId(), calendarId: from, eventId, op: 'delete', payload: { remoteId: row.remoteId, etag: row.etag }, createdAt: deps.now() });
      }
      // Land the event on the new calendar, dropping remote identity.
      deps.events.update(eventId, { calendarId: toCalendarId, remoteId: null, etag: null, syncStatus: toCalendarId.startsWith('google:') ? 'local-dirty' : null });
      if (toCalendarId.startsWith('google:') && deps.directionOf(toCalendarId) === 'two-way') {
        deps.sync.enqueue({ opId: newId(), calendarId: toCalendarId, eventId, op: 'create', payload: null, createdAt: deps.now() });
      }
    },
  };
}

/** A Google-valid event id (base32hex, 5-1024 chars) derived from our op id, for insert idempotency. */
function idempotentId(opId: string): string {
  const hex = opId.replace(/[^0-9a-v]/gi, '').toLowerCase();
  return `apollo${hex}`.slice(0, 100);
}
