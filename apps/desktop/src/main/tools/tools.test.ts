import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createTimerTools } from './timer';
import { createAlarmTools } from './alarm';
import { createNoteTools } from './note';
import { createContactTools } from './contact';
import { createMemoryTools } from './memory';
import { createUndoTool } from './undo';
import { createRegistry, type Registry } from './registry';
import { makeCtx } from './registry.test';

let db: Db;
let repos: Repos;
let reg: Registry;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  reg = createRegistry([
    ...createTimerTools({ timers: repos.timers, undo: repos.undo }),
    ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo }),
    ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
    ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
    ...createMemoryTools({ memory: repos.memory, undo: repos.undo }),
    createUndoTool(repos),
  ]);
});

describe('timer tools', () => {
  it('start persists, returns timer card, and undo.last cancels it', async () => {
    const res = await reg.execute('timer.start', { durationSec: 300, label: 'pasta' }, makeCtx());
    expect(res.llmText).toContain('5 minutes');
    expect(res.card).toMatchObject({ kind: 'timer', label: 'pasta' });
    expect(repos.timers.listActive()).toHaveLength(1);

    const undo = await reg.execute('undo.last', {}, makeCtx());
    expect(undo.llmText).toContain('canceled the timer');
    expect(repos.timers.listActive()).toHaveLength(0);
  });

  it('cancel matches by label; list reports remaining', async () => {
    await reg.execute('timer.start', { durationSec: 60, label: 'tea' }, makeCtx());
    await reg.execute('timer.start', { durationSec: 600, label: 'laundry' }, makeCtx());
    const list = await reg.execute('timer.list', {}, makeCtx());
    expect(list.llmText).toContain('2 timers');

    const res = await reg.execute('timer.cancel', { label: 'tea' }, makeCtx());
    expect(res.llmText).toContain('tea');
    expect(repos.timers.listActive().map((t) => t.label)).toEqual(['laundry']);
  });

  it('cancel with nothing running warns instead of erroring', async () => {
    expect((await reg.execute('timer.cancel', {}, makeCtx())).llmText).toMatch(/^WARNING/);
  });
});

describe('alarm.set', () => {
  it('persists recurring alarms and warns on past one-shots', async () => {
    const rec = await reg.execute('alarm.set', { atIso: '2026-07-13T07:00:00', rrule: 'FREQ=DAILY' }, makeCtx());
    expect(rec.llmText).toContain('repeating');
    const past = await reg.execute('alarm.set', { atIso: '2020-01-01T08:00:00' }, makeCtx());
    expect(past.llmText).toContain('WARNING');
    expect(repos.alarms.listEnabled()).toHaveLength(2);
  });
});

describe('note tools', () => {
  it('save + FTS search with snippets; undo removes note', async () => {
    await reg.execute('note.save', { content: 'garage door code is 4831' }, makeCtx());
    const found = await reg.execute('note.search', { query: 'garage code' }, makeCtx());
    expect(found.llmText).toContain('4831');

    await reg.execute('undo.last', {}, makeCtx());
    const gone = await reg.execute('note.search', { query: 'garage' }, makeCtx());
    expect(gone.llmText).toContain('No notes matched');
  });
});


describe('contact + memory tools', () => {
  it('contact add/find round trip', async () => {
    await reg.execute('contact.add', { name: 'Jane Doe', email: 'jane@x.com' }, makeCtx());
    const res = await reg.execute('contact.find', { name: 'jane' }, makeCtx());
    expect(res.llmText).toContain('jane@x.com');
    expect((await reg.execute('contact.find', { name: 'zzz' }, makeCtx())).llmText).toContain('No contact matched');
  });

  it('memory save/forget with undo restore', async () => {
    await reg.execute('memory.save', { category: 'person', fact: 'partner lives in Columbus' }, makeCtx());
    expect(repos.memory.digest()).toContain('Columbus');

    await reg.execute('memory.forget', { fact: 'partner Columbus' }, makeCtx());
    expect(repos.memory.digest()).not.toContain('Columbus');

    await reg.execute('undo.last', {}, makeCtx());
    expect(repos.memory.digest()).toContain('Columbus');
  });

  it('memory.save rejects unknown categories', async () => {
    expect((await reg.execute('memory.save', { category: 'astrology', fact: 'x' }, makeCtx())).llmText).toMatch(/^ERROR invalid arguments/);
  });
});

describe('undo.last edge cases', () => {
  it('empty conversation has nothing to undo', async () => {
    const res = await reg.execute('undo.last', {}, makeCtx({ convId: 'fresh' }));
    expect(res.llmText).toBe('There is nothing to undo in this conversation.');
  });
});
