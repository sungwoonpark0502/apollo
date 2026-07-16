import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { applyUndoEntry, undoLabel } from './undo';
// Importing the workspace handlers registers the UI inverses (event exdate etc.).
import '../ipc/handlers/workspace';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

describe('I3 global undo ring across surfaces', () => {
  it('undo.recent lists the last actions newest-first with human labels, across surfaces', () => {
    const note = repos.notes.save({ content: 'Groceries' });
    repos.undo.push({ turnId: 't1', convId: 'voice-conv', tool: 'note.save', data: { id: note.id } });
    const todo = repos.todos.add({ content: 'call mom' });
    repos.undo.push({ turnId: 't2', convId: 'workspace-ui', tool: 'todo.add', data: { id: todo.id } });

    const recent = repos.undo.recent(10);
    expect(recent).toHaveLength(2);
    expect(undoLabel(recent[0]!.tool)).toBe('Added a to-do'); // newest first, from the workspace surface
    expect(undoLabel(recent[1]!.tool)).toBe('Created a note'); // from the voice surface
  });

  it('popNewest reverses the most recent action regardless of surface', () => {
    const note = repos.notes.save({ content: 'keep' });
    repos.undo.push({ turnId: 't1', convId: 'voice-conv', tool: 'note.save', data: { id: note.id } });
    const todo = repos.todos.add({ content: 'undo me' });
    repos.undo.push({ turnId: 't2', convId: 'workspace-ui', tool: 'todo.add', data: { id: todo.id } });

    const entry = repos.undo.popNewest()!;
    expect(entry.tool).toBe('todo.add');
    const what = applyUndoEntry(repos, entry);
    expect(what).toBe('removed the todo');
    expect(repos.todos.get(todo.id)?.deletedAt).toBeTruthy();
    // the note action remains on the ring
    expect(repos.undo.recent(10)).toHaveLength(1);
  });

  it('undoing a deleted recurring occurrence restores it via the exdate inverse', () => {
    const ev = repos.events.create({
      title: 'Standup', startTs: Date.UTC(2026, 6, 13, 16, 0), endTs: Date.UTC(2026, 6, 13, 16, 30),
      tz: 'UTC', rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const dateIso = '2026-07-20';
    repos.events.addExdate(ev.id, dateIso);
    repos.undo.push({ turnId: 't1', convId: 'workspace-ui', tool: 'workspace.event.exdate', data: { id: ev.id, dateIso } });

    expect(undoLabel('workspace.event.exdate')).toBe('Deleted this occurrence');
    const gone = repos.events.expandOccurrences(Date.UTC(2026, 6, 20, 0, 0), Date.UTC(2026, 6, 20, 23, 59));
    expect(gone.find((o) => o.eventId === ev.id)).toBeUndefined();

    const entry = repos.undo.popNewest()!;
    const what = applyUndoEntry(repos, entry);
    expect(what).toBe('restored the occurrence');
    const back = repos.events.expandOccurrences(Date.UTC(2026, 6, 20, 0, 0), Date.UTC(2026, 6, 20, 23, 59));
    expect(back.find((o) => o.eventId === ev.id)).toBeDefined();
  });

  it('label map distinguishes occurrence deletes from whole-event deletes', () => {
    expect(undoLabel('workspace.event.exdate')).toBe('Deleted this occurrence');
    expect(undoLabel('calendar.delete')).toBe('Deleted an event');
    expect(undoLabel('unknown.tool')).toBe('Last action');
  });
});
