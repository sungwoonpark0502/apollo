import { type CalendarCollection, type Settings } from '@apollo/shared';
import { type Repos } from '../db/repos/index';
import { createSyncEngine, type ConflictInfo } from './syncEngine';
import { gCalendarToCollection, remoteCalendarId } from './mapping';
import { type GoogleCalendarClient } from './types';

/**
 * I7 Google Calendar module. Entirely inert unless googleCalendar.enabled: no
 * network, no scopes, no background work. connect() is the only opt-in action
 * (it requests the calendar scope); everything else early-returns when disabled.
 */
export type GCalStatus = 'idle' | 'syncing' | 'error';

export interface GCalModuleDeps {
  repos: Repos;
  getSettings: () => Settings;
  setSettings: (s: Settings) => void;
  /** Build an authed client, or null when not connected. Real impl uses net.fetch + the calendar token. */
  makeClient: () => GoogleCalendarClient | null;
  pushState: (s: { status: GCalStatus; lastSyncTs: number | null; message?: string }) => void;
  /** I7.4: surface a conflict to the user (rendered as a syncConflict card). */
  onConflict?: (c: ConflictInfo) => void;
  revoke?: () => Promise<void>;
  now?: () => number;
  log?: (m: string) => void;
}

const TICK_MS = 15 * 60_000;
const FOCUS_STALE_MS = 5 * 60_000;

export function createGCalModule(deps: GCalModuleDeps) {
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  const conflicts: ConflictInfo[] = [];

  const enabled = (): boolean => deps.getSettings().googleCalendar.enabled;

  function directionOf(): 'read-only' | 'two-way' {
    return deps.getSettings().googleCalendar.direction;
  }

  function engineFor(client: GoogleCalendarClient) {
    return createSyncEngine({
      client,
      events: deps.repos.events,
      sync: deps.repos.sync,
      syncedCalendars: () => deps.getSettings().googleCalendar.syncedCalendarIds,
      directionOf,
      now,
      onConflict: (c) => {
        conflicts.push(c);
        deps.onConflict?.(c);
        deps.pushState({ status: 'error', lastSyncTs: deps.getSettings().googleCalendar.lastSyncTs, message: 'conflict' });
      },
      log: deps.log,
    });
  }

  async function sync(): Promise<{ ok: boolean; changed: number }> {
    if (!enabled()) return { ok: false, changed: 0 }; // inert when disabled
    const client = deps.makeClient();
    if (!client) return { ok: false, changed: 0 };
    deps.pushState({ status: 'syncing', lastSyncTs: deps.getSettings().googleCalendar.lastSyncTs });
    try {
      const changed = await engineFor(client).runAll();
      const ts = now();
      patchGoogle({ lastSyncTs: ts });
      deps.pushState({ status: 'idle', lastSyncTs: ts });
      return { ok: true, changed };
    } catch (e) {
      // Degrade silently to the last local state; surface an unobtrusive indicator.
      deps.log?.(`gcal sync failed: ${e instanceof Error ? e.message : String(e)}`);
      deps.pushState({ status: 'error', lastSyncTs: deps.getSettings().googleCalendar.lastSyncTs, message: 'sync failed' });
      return { ok: false, changed: 0 };
    }
  }

  function patchGoogle(partial: Partial<Settings['googleCalendar']>): void {
    const s = deps.getSettings();
    deps.setSettings({ ...s, googleCalendar: { ...s.googleCalendar, ...partial } });
  }

  return {
    enabled,
    pendingConflicts: (): ConflictInfo[] => [...conflicts],

    /** Opt-in: list the user's Google calendars for selection (requests the scope in the real flow). */
    async connect(): Promise<{ ok: boolean; calendars?: CalendarCollection[] }> {
      const client = deps.makeClient();
      if (!client) return { ok: false };
      const list = await client.listCalendars();
      return { ok: true, calendars: list.map(gCalendarToCollection) };
    },

    /** Enable sync for the chosen calendars; adds them to calendars.active. */
    applySelection(collections: CalendarCollection[], direction: 'read-only' | 'two-way'): void {
      const s = deps.getSettings();
      const nonGoogle = s.calendars.active.filter((c) => c.kind !== 'google');
      deps.setSettings({
        ...s,
        calendars: { ...s.calendars, active: [...nonGoogle, ...collections] },
        googleCalendar: { enabled: true, syncedCalendarIds: collections.map((c) => c.id), direction, lastSyncTs: null },
      });
    },

    sync,

    /** Sync on focus only when the last sync is stale, to avoid churn. */
    async onFocus(): Promise<void> {
      if (!enabled()) return;
      const last = deps.getSettings().googleCalendar.lastSyncTs ?? 0;
      if (now() - last > FOCUS_STALE_MS) await sync();
    },

    start(): void {
      if (timer) return;
      timer = setInterval(() => void sync(), TICK_MS); // 15-min cadence while running
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },

    resolveConflict(eventId: string, choice: 'mine' | 'theirs' | 'both'): void {
      const client = deps.makeClient();
      if (!client) return;
      engineFor(client).resolveConflict(eventId, choice);
      const i = conflicts.findIndex((c) => c.eventId === eventId);
      if (i >= 0) conflicts.splice(i, 1);
    },

    /** Disconnect: keep synced events as local copies, or remove them; then revoke + drop sync state. */
    async disconnect(keepLocal: boolean): Promise<void> {
      const s = deps.getSettings();
      const googleCals = s.calendars.active.filter((c) => c.kind === 'google');
      for (const c of googleCals) {
        if (keepLocal) deps.repos.events.convertCalendarToLocal(c.id);
        else deps.repos.events.deleteByCalendar(c.id);
        deps.repos.sync.clearToken(c.id);
      }
      deps.repos.sync.clearAll();
      const nextDefault = s.calendars.defaultCalendarId.startsWith('google:') ? 'default' : s.calendars.defaultCalendarId;
      deps.setSettings({
        ...s,
        calendars: { active: s.calendars.active.filter((c) => c.kind !== 'google'), defaultCalendarId: nextDefault },
        googleCalendar: { enabled: false, syncedCalendarIds: [], direction: 'read-only', lastSyncTs: null },
      });
      this.stop();
      await deps.revoke?.();
    },

    /** Exposed for callers that need the remote id behind a collection. */
    remoteIdOf: remoteCalendarId,
  };
}

export type GCalModule = ReturnType<typeof createGCalModule>;
