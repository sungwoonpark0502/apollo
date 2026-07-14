import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { type DataChanged } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createDataBus } from '../db/bus';
import { createRepos, type Repos } from '../db/repos/index';
import { buildWorkspaceHandlers } from '../ipc/handlers/workspace';
import { createQuickCaptureService } from './service';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-07-11T10:00:00-07:00').getTime();
let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});

function service(bus = createDataBus()): { svc: ReturnType<typeof createQuickCaptureService>; repos: Repos; bus: typeof bus } {
  repos = createRepos(db, bus);
  const svc = createQuickCaptureService({ repos, tz: () => TZ, defaultType: () => 'note', now: () => NOW });
  return { svc, repos, bus };
}

describe('Quick Capture save path (F4)', () => {
  it('a captured note is visible via notes.list within one tick (live-sync)', () => {
    const bus = createDataBus();
    const changes: DataChanged[] = [];
    bus.subscribe((c) => changes.push(c));
    const { svc, repos: r } = service(bus);
    const handlers = buildWorkspaceHandlers({ repos: r, tz: () => TZ, openWorkspace: vi.fn(), log: () => undefined });

    const res = svc.submit({ text: 'buy milk and eggs', type: 'note' });
    expect(res).toEqual({ ok: true, savedAs: 'note', id: res.id });
    // same tick: DataBus fired and the Workspace read path sees it
    expect(changes).toContainEqual({ entity: 'note', op: 'create', id: res.id });
    expect(handlers['notes.list']({ limit: 50 }).map((n) => n.id)).toContain(res.id);
  });

  it('saves a todo', () => {
    const { svc, repos: r } = service();
    const res = svc.submit({ text: 'file taxes', type: 'todo' });
    expect(res.savedAs).toBe('todo');
    expect(r.todos.listAll().some((t) => t.id === res.id && t.content === 'file taxes')).toBe(true);
  });

  it('saves a reminder at the resolved time and re-arms the scheduler', () => {
    const bus = createDataBus();
    repos = createRepos(db, bus);
    const onReminderArmed = vi.fn();
    const svc = createQuickCaptureService({ repos, tz: () => TZ, defaultType: () => 'note', now: () => NOW, onReminderArmed });
    const iso = '2026-07-11T18:00:00-07:00';
    const res = svc.submit({ text: 'call mom', type: 'reminder', reminderIso: iso });
    expect(res.savedAs).toBe('reminder');
    expect(repos.reminders.get(res.id)?.dueTs).toBe(DateTime.fromISO(iso).toMillis());
    expect(onReminderArmed).toHaveBeenCalled();
  });

  it('rejects empty text (validation failure → shake, no save)', () => {
    const { svc } = service();
    expect(() => svc.submit({ text: '   ', type: 'note' })).toThrow();
  });

  it('classify runs the same golden logic (reminder detection)', () => {
    const { svc } = service();
    const c = svc.classify({ text: 'call mom tomorrow at 6' });
    expect(c.suggestedType).toBe('reminder');
    expect(c.reminderIso).toBeTruthy();
  });
});
