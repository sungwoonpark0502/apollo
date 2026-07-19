import { beforeEach, describe, expect, it } from 'vitest';
import { docToPlainText, readChecklistFromDoc, type NoteDoc } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createRegistry, type Registry } from '../tools/registry';
import { createNoteTools } from '../tools/note';
import { createUndoTool } from '../tools/undo';
import { makeCtx } from '../tools/registry.test';
import { chunkNote } from '../memory/chunker';

/**
 * L4.5/L4.6: the doc is the source of truth and the plain-text mirror is
 * regenerated from it on save, so FTS, the embedding chunker, and title/snippet
 * keep working. Checklist and table text must be reachable by note.search and
 * the recall projection.
 */
let db: Db;
let repos: Repos;
let reg: Registry;

const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  reg = createRegistry([...createNoteTools({ notes: repos.notes, undo: repos.undo }), createUndoTool(repos)]);
});

describe('L4 doc storage + mirror regeneration', () => {
  it('saveDoc persists the doc and rewrites the plain-text mirror from it', () => {
    const note = repos.notes.save({ content: 'placeholder' });
    const doc: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Trip' }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('renew passport')] }] },
      ],
    };
    const saved = repos.notes.saveDoc(note.id, doc)!;
    expect(saved.content).toBe('Trip\nrenew passport'); // mirror regenerated
    expect(JSON.parse(saved.doc!)).toEqual(doc); // doc persisted verbatim
  });

  it('getDoc wraps a legacy plain note, parsing 0008 checklist lines', () => {
    const note = repos.notes.save({ content: 'To-dos\n- [ ] buy milk\n- [x] file taxes' });
    const doc = repos.notes.getDoc(note.id)!;
    expect(readChecklistFromDoc(doc)).toEqual([
      { checked: false, text: 'buy milk' },
      { checked: true, text: 'file taxes' },
    ]);
  });

  it('the title/snippet derivation still works off the regenerated mirror', () => {
    const note = repos.notes.save({ content: 'x' });
    repos.notes.saveDoc(note.id, { type: 'doc', content: [p('Groceries'), p('milk and eggs')] });
    const listed = repos.notes.list({ limit: 10 }).find((n) => n.id === note.id)!;
    expect(listed.title).toBe('Groceries');
    expect(listed.snippet).toBe('milk and eggs');
  });
});

describe('L4.5 FTS + recall parity for checklist and table text', () => {
  function seedRichNote(): string {
    const note = repos.notes.save({ content: 'x' });
    repos.notes.saveDoc(note.id, {
      type: 'doc',
      content: [
        p('Trip plan'),
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('renew passport')] }] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('City')] }, { type: 'tableHeader', content: [p('Nights')] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Lisbon')] }, { type: 'tableCell', content: [p('3')] }] },
          ],
        },
      ],
    });
    return note.id;
  }

  it('a checklist item is findable via FTS', () => {
    seedRichNote();
    expect(repos.notes.search('passport')).toHaveLength(1);
  });

  it('a table cell is findable via FTS', () => {
    seedRichNote();
    expect(repos.notes.search('Lisbon')).toHaveLength(1);
    expect(repos.notes.search('Nights')).toHaveLength(1);
  });

  it('the recall/embedding chunker sees checklist and table text', () => {
    const id = seedRichNote();
    const chunks = chunkNote(repos.notes.get(id)!.content);
    const joined = chunks.join('\n');
    expect(joined).toContain('renew passport');
    expect(joined).toContain('Lisbon');
  });

  it('note.search finds a checklist item through the tool path', async () => {
    seedRichNote();
    const res = await reg.execute('note.search', { query: 'passport' }, makeCtx());
    expect(res.llmText).toContain('Found 1 note');
  });
});

describe('L4.4 note.appendChecklistItem tool', () => {
  it('creates the list note on first use and reads back', async () => {
    const add = await reg.execute('note.appendChecklistItem', { item: 'buy milk' }, makeCtx());
    expect(add.llmText).toContain('buy milk');
    expect(add.undoToken).toBeTruthy();

    const read = await reg.execute('note.readList', {}, makeCtx());
    expect(read.llmText).toContain('buy milk');
    expect(read.llmText).toContain('1 still open');
  });

  it('appends to the same list note rather than creating another', async () => {
    await reg.execute('note.appendChecklistItem', { item: 'buy milk' }, makeCtx());
    await reg.execute('note.appendChecklistItem', { item: 'file taxes' }, makeCtx());
    const listNotes = repos.notes.list({ limit: 20 }).filter((n) => n.title === 'To-dos');
    expect(listNotes).toHaveLength(1);
    const doc = repos.notes.getDoc(listNotes[0]!.id)!;
    expect(readChecklistFromDoc(doc).map((i) => i.text)).toEqual(['buy milk', 'file taxes']);
  });

  it('an empty list reads back as empty, not as an error', async () => {
    const read = await reg.execute('note.readList', {}, makeCtx());
    expect(read.llmText).toBe('Your list is empty.');
  });

  it('undo removes the appended item (and the note when it created it)', async () => {
    const first = await reg.execute('note.appendChecklistItem', { item: 'buy milk' }, makeCtx());
    expect(first.undoToken).toBeTruthy();
    const undone = await reg.execute('undo.last', {}, makeCtx());
    expect(undone.llmText.toLowerCase()).toContain('list');
    expect(repos.notes.list({ limit: 20 }).filter((n) => n.title === 'To-dos')).toHaveLength(0);
  });

  it('appended items are immediately searchable (mirror stays in step)', async () => {
    await reg.execute('note.appendChecklistItem', { item: 'renew passport' }, makeCtx());
    expect(repos.notes.search('passport')).toHaveLength(1);
  });
});

describe('L4 export uses the doc so structure survives', () => {
  it('a note with structure exports richer markdown than its flat mirror', () => {
    const note = repos.notes.save({ content: 'x' });
    const doc: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Packing' }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('passport')] }] },
      ],
    };
    const saved = repos.notes.saveDoc(note.id, doc)!;
    expect(saved.content).toBe('Packing\npassport'); // flat mirror
    expect(docToPlainText(doc)).toBe(saved.content);
    // Export renders from the doc (asserted end-to-end in the export suite).
    expect(JSON.parse(saved.doc!).content[0].type).toBe('heading');
  });
});
