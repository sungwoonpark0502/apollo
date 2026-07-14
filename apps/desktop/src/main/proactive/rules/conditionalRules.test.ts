import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { defaultSettings, type Settings } from '@apollo/shared';
import { openDb, type Db } from '../../db/connection';
import { migrate } from '../../db/migrate';
import { createRepos, type Repos } from '../../db/repos/index';
import { needsReply } from './needsReply';
import { weatherHeadsUp } from './weatherHeadsUp';
import { type RuleCtx } from '../types';

const TZ = 'America/Los_Angeles';
let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function baseCtx(nowIso: string, over: Partial<RuleCtx> = {}): RuleCtx {
  return { now: DateTime.fromISO(nowIso, { zone: TZ }).toMillis(), tz: TZ, repos, settings: defaultSettings(), gmailConnected: false, ...over };
}

function withHome(): Settings {
  const s = defaultSettings();
  s.profile.homePlace = { label: 'Home', lat: 1, lon: 2, tz: TZ };
  return s;
}

describe('needs_reply rule (Gmail-conditional)', () => {
  it('skips silently when Gmail is not connected', async () => {
    const email = vi.fn(async () => [{ from: 'a@x.com', subject: 'Hi' }]);
    const c = await needsReply.evaluate(baseCtx('2026-07-13T13:00:00', { gmailConnected: false, emailNeedingReply: email }));
    expect(c).toHaveLength(0);
    expect(email).not.toHaveBeenCalled();
  });

  it('fires at atHH with a digest of up to 3 threads (inert text)', async () => {
    const email = vi.fn(async () => [
      { from: 'a@x.com', subject: 'Lease' },
      { from: 'b@x.com', subject: 'Invoice' },
      { from: 'c@x.com', subject: 'Lunch' },
      { from: 'd@x.com', subject: 'Extra' },
    ]);
    const c = await needsReply.evaluate(baseCtx('2026-07-13T13:00:00', { gmailConnected: true, emailNeedingReply: email }));
    expect(c).toHaveLength(1);
    expect(c[0]!.urgency).toBe('normal');
    expect((c[0]!.card as { kind: 'text'; body: string }).body.split('\n')).toHaveLength(3); // max 3
    expect(c[0]!.title).toContain('4'); // count reflects all threads
  });

  it('does not fire before atHH', async () => {
    const email = vi.fn(async () => [{ from: 'a@x.com', subject: 'Hi' }]);
    expect(await needsReply.evaluate(baseCtx('2026-07-13T12:00:00', { gmailConnected: true, emailNeedingReply: email }))).toHaveLength(0);
  });

  it('does not fire when there are no stale threads', async () => {
    const email = vi.fn(async () => []);
    expect(await needsReply.evaluate(baseCtx('2026-07-13T13:00:00', { gmailConnected: true, emailNeedingReply: email }))).toHaveLength(0);
  });
});

describe('weather_heads_up rule (homePlace-conditional)', () => {
  function eventWithLocation(startIso: string): void {
    const start = DateTime.fromISO(startIso, { zone: TZ });
    repos.events.create({ title: 'Client meeting', startTs: start.toMillis(), endTs: start.plus({ hours: 1 }).toMillis(), tz: TZ, location: 'Downtown' });
  }

  it('skips when homePlace is unset', async () => {
    eventWithLocation('2026-07-13T14:00:00');
    const precip = vi.fn(async () => 90);
    const c = await weatherHeadsUp.evaluate(baseCtx('2026-07-13T08:00:00', { settings: defaultSettings(), weatherPrecipNext12h: precip }));
    expect(c).toHaveLength(0);
    expect(precip).not.toHaveBeenCalled();
  });

  it('fires when precip >= 70% and a located event exists today', async () => {
    eventWithLocation('2026-07-13T14:00:00');
    const c = await weatherHeadsUp.evaluate(baseCtx('2026-07-13T08:00:00', { settings: withHome(), weatherPrecipNext12h: async () => 80 }));
    expect(c).toHaveLength(1);
    expect(c[0]!.body).toContain('Client meeting');
  });

  it('does not fire at precip 69 (boundary, < 70)', async () => {
    eventWithLocation('2026-07-13T14:00:00');
    expect(await weatherHeadsUp.evaluate(baseCtx('2026-07-13T08:00:00', { settings: withHome(), weatherPrecipNext12h: async () => 69 }))).toHaveLength(0);
  });

  it('fires at precip exactly 70 (boundary)', async () => {
    eventWithLocation('2026-07-13T14:00:00');
    expect(await weatherHeadsUp.evaluate(baseCtx('2026-07-13T08:00:00', { settings: withHome(), weatherPrecipNext12h: async () => 70 }))).toHaveLength(1);
  });

  it('does not fire without a located event', async () => {
    const start = DateTime.fromISO('2026-07-13T14:00:00', { zone: TZ });
    repos.events.create({ title: 'No location', startTs: start.toMillis(), endTs: start.plus({ hours: 1 }).toMillis(), tz: TZ, location: null });
    expect(await weatherHeadsUp.evaluate(baseCtx('2026-07-13T08:00:00', { settings: withHome(), weatherPrecipNext12h: async () => 90 }))).toHaveLength(0);
  });

  it('does not fire before 07:30', async () => {
    eventWithLocation('2026-07-13T14:00:00');
    expect(await weatherHeadsUp.evaluate(baseCtx('2026-07-13T07:00:00', { settings: withHome(), weatherPrecipNext12h: async () => 90 }))).toHaveLength(0);
  });
});
