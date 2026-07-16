import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createGCalModule } from './module';
import { type GCalListEntry, type GEventsPage, type GoogleCalendarClient } from './types';

class MockGoogle implements GoogleCalendarClient {
  calls = { listCalendars: 0, listEvents: 0 };
  calendars: GCalListEntry[] = [{ id: 'primary', summary: 'James', accessRole: 'owner', backgroundColor: '#4986e7' }];
  async listCalendars(): Promise<GCalListEntry[]> { this.calls.listCalendars++; return this.calendars; }
  async listEvents(): Promise<GEventsPage> { this.calls.listEvents++; return { items: [], nextSyncToken: 't' }; }
  async insertEvent(): Promise<never> { throw new Error('unused'); }
  async patchEvent(): Promise<never> { throw new Error('unused'); }
  async deleteEvent(): Promise<void> {}
}

let db: Db;
let repos: Repos;
let settings: Settings;
let google: MockGoogle;

function module(clientWhenConnected = true) {
  return createGCalModule({
    repos,
    getSettings: () => settings,
    setSettings: (s) => { settings = s; },
    makeClient: () => (clientWhenConnected ? google : null),
    pushState: vi.fn(),
    revoke: vi.fn(async () => {}),
    now: () => 1_800_000_000_000,
  });
}

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  settings = defaultSettings();
  google = new MockGoogle();
});

describe('I7 module — inert unless enabled', () => {
  it('sync does nothing and touches no client when googleCalendar.enabled is false', async () => {
    expect(settings.googleCalendar.enabled).toBe(false);
    const m = module();
    const r = await m.sync();
    expect(r).toEqual({ ok: false, changed: 0 });
    expect(google.calls.listEvents).toBe(0);
    expect(m.enabled()).toBe(false);
  });

  it('onFocus and the tick are inert when disabled', async () => {
    const m = module();
    await m.onFocus();
    m.start();
    m.stop();
    expect(google.calls.listEvents).toBe(0);
  });
});

describe('I7 module — connect + selection', () => {
  it('connect lists calendars mapped to local collections (nearest palette color, read-only flag)', async () => {
    google.calendars = [
      { id: 'primary', summary: 'James', accessRole: 'owner', backgroundColor: '#4986e7' },
      { id: 'team@x.com', summary: 'Team', accessRole: 'reader', backgroundColor: '#16a765' },
    ];
    const res = await module().connect();
    expect(res.ok).toBe(true);
    expect(res.calendars).toHaveLength(2);
    expect(res.calendars![0]).toMatchObject({ id: 'google:primary', kind: 'google', readOnly: false });
    expect(res.calendars![1]).toMatchObject({ id: 'google:team@x.com', readOnly: true });
  });

  it('applySelection enables sync and adds the calendars to calendars.active', async () => {
    const m = module();
    const { calendars } = await m.connect();
    m.applySelection([calendars![0]!], 'two-way');
    expect(settings.googleCalendar.enabled).toBe(true);
    expect(settings.googleCalendar.direction).toBe('two-way');
    expect(settings.googleCalendar.syncedCalendarIds).toEqual(['google:primary']);
    expect(settings.calendars.active.some((c) => c.id === 'google:primary' && c.kind === 'google')).toBe(true);
    // once enabled, sync actually runs
    expect((await m.sync()).ok).toBe(true);
    expect(google.calls.listEvents).toBe(1);
  });
});

describe('I7 module — disconnect', () => {
  function connectAndSeed(): { collectionId: string } {
    const collectionId = 'google:primary';
    settings = {
      ...settings,
      calendars: { active: [...settings.calendars.active, { id: collectionId, name: 'James', color: '#4C8BF5', kind: 'google', readOnly: false }], defaultCalendarId: 'default' },
      googleCalendar: { enabled: true, syncedCalendarIds: [collectionId], direction: 'two-way', lastSyncTs: 1 },
    };
    repos.events.create({ title: 'Synced', startTs: Date.UTC(2026, 6, 15, 16, 0), endTs: null, tz: 'UTC', calendarId: collectionId, remoteId: 'r1', etag: 'e1', syncStatus: 'synced' });
    repos.sync.setToken(collectionId, 'tok', 1);
    return { collectionId };
  }

  it('keep-local: converts synced events to local, strips remote fields, drops sync state + config', async () => {
    const { collectionId } = connectAndSeed();
    const m = module();
    await m.disconnect(true);
    const events = repos.events.allActive();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ calendarId: 'default', remoteId: null, etag: null });
    expect(settings.calendars.active.some((c) => c.kind === 'google')).toBe(false);
    expect(settings.googleCalendar.enabled).toBe(false);
    expect(repos.sync.getToken(collectionId)).toBeNull();
  });

  it('remove: soft-deletes synced events and revokes', async () => {
    connectAndSeed();
    const revoke = vi.fn(async () => {});
    const m = createGCalModule({
      repos, getSettings: () => settings, setSettings: (s) => { settings = s; },
      makeClient: () => google, pushState: vi.fn(), revoke, now: () => 1,
    });
    await m.disconnect(false);
    expect(repos.events.allActive()).toHaveLength(0);
    expect(settings.googleCalendar.enabled).toBe(false);
    expect(revoke).toHaveBeenCalled();
  });
});
