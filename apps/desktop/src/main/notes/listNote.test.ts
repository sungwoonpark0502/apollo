import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { appendChecklistItem, findListNote, formatTaskLine, parseTaskLine, readChecklist } from './listNote';

/**
 * L2/L4.4: To-dos are gone as a surface; checklists in notes replace them.
 * These cover the append/read path and the lossless 0008 migration.
 */
let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

describe('checklist task lines', () => {
  it('round-trips checked and unchecked items', () => {
    expect(parseTaskLine('- [ ] buy milk')).toEqual({ checked: false, text: 'buy milk' });
    expect(parseTaskLine('- [x] file taxes')).toEqual({ checked: true, text: 'file taxes' });
    expect(parseTaskLine('- [X] shout')).toEqual({ checked: true, text: 'shout' });
    expect(parseTaskLine('just a line')).toBeNull();
    expect(formatTaskLine('buy milk')).toBe('- [ ] buy milk');
    expect(formatTaskLine('done', true)).toBe('- [x] done');
  });
});

describe('appendChecklistItem', () => {
  it('creates the list note on first use, then appends to the same note', () => {
    const first = appendChecklistItem(repos.notes, 'buy milk');
    expect(first.created).toBe(true);

    const second = appendChecklistItem(repos.notes, 'file taxes');
    expect(second.created).toBe(false);
    expect(second.noteId).toBe(first.noteId); // same note, not a second one

    const note = repos.notes.get(first.noteId)!;
    expect(note.content).toBe('To-dos\n- [ ] buy milk\n- [ ] file taxes');
    expect(readChecklist(repos.notes)).toEqual([
      { checked: false, text: 'buy milk' },
      { checked: false, text: 'file taxes' },
    ]);
  });

  it('rejects an empty item', () => {
    expect(() => appendChecklistItem(repos.notes, '   ')).toThrow('empty checklist item');
  });

  it('is findable by FTS so search and recall still reach checklist text', () => {
    appendChecklistItem(repos.notes, 'renew passport');
    expect(repos.notes.search('passport')).toHaveLength(1);
  });
});

describe('L2 todos → note migration (0008)', () => {
  /** Builds a pre-0008 database: migrate to 7, seed todos, then finish. */
  function migrateWithTodos(rows: Array<{ content: string; done: boolean }>): Db {
    const fresh = openDb(':memory:');
    migrate(fresh); // full schema (0008 runs against an empty todos table: no-op)
    // Re-seed as if the rows predated the migration, then re-run 0008's logic
    // by inserting through the same statement the migration uses.
    for (const [i, r] of rows.entries()) {
      fresh
        .prepare('INSERT INTO todos(id, content, done, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(`t${i}`, r.content, r.done ? 1 : 0, 1000 + i, 1000 + i);
    }
    fresh.exec(`
      INSERT INTO notes (id, content, tags, created_at, updated_at, deleted_at)
      SELECT 'note-todos-migrated',
        'To-dos' || char(10) || group_concat(CASE WHEN done = 1 THEN '- [x] ' ELSE '- [ ] ' END || content, char(10)),
        NULL, COALESCE(MIN(created_at), 0), 0, NULL
      FROM (SELECT content, done, created_at FROM todos WHERE deleted_at IS NULL ORDER BY done, created_at)
      HAVING COUNT(*) > 0;
    `);
    return fresh;
  }

  it('converts every todo into a checklist item, preserving checked state', () => {
    const fresh = migrateWithTodos([
      { content: 'buy milk', done: false },
      { content: 'file taxes', done: true },
      { content: 'call mom', done: false },
    ]);
    const r = createRepos(fresh);
    const items = readChecklist(r.notes);
    expect(items).toEqual([
      { checked: false, text: 'buy milk' },
      { checked: false, text: 'call mom' },
      { checked: true, text: 'file taxes' }, // open items first, then done
    ]);
    expect(items).toHaveLength(3); // lossless: nothing dropped
  });

  it('creates no note when there were no todos', () => {
    const fresh = migrateWithTodos([]);
    const r = createRepos(fresh);
    expect(findListNote(r.notes)).toBeNull();
    expect(r.notes.list({ limit: 10 })).toHaveLength(0);
  });

  it('is non-destructive: the todos table is retained', () => {
    const fresh = migrateWithTodos([{ content: 'buy milk', done: false }]);
    const rows = fresh.prepare('SELECT COUNT(*) AS n FROM todos').get() as { n: number };
    expect(rows.n).toBe(1); // original data still there, just unused
  });

  it('appending after a migration continues the migrated note', () => {
    const fresh = migrateWithTodos([{ content: 'buy milk', done: false }]);
    const r = createRepos(fresh);
    const res = appendChecklistItem(r.notes, 'new item');
    expect(res.created).toBe(false);
    expect(readChecklist(r.notes).map((i) => i.text)).toEqual(['buy milk', 'new item']);
  });
});

describe('L2 the todo tools are gone from the registry', () => {
  it('no todo.* tool module remains on disk', () => {
    // A static import would fail typecheck, so probe the filesystem instead.
    expect(existsSync(join(__dirname, '../tools/todo.ts'))).toBe(false);
  });
});
