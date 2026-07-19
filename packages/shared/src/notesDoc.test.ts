import { describe, expect, it } from 'vitest';
import {
  appendChecklistItemToDoc,
  docTitle,
  docToMarkdown,
  joinTitle,
  splitTitle,
  docToPlainText,
  parseDoc,
  plainTextToDoc,
  readChecklistFromDoc,
  type NoteDoc,
} from './notesDoc';

/**
 * L7: TipTap doc save + plain-text mirror regeneration; every block type
 * round-trips doc→markdown on export; checklist and table text appear in the
 * projection that feeds FTS/recall; appendChecklistItem creates and appends.
 */
const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

const RICH: NoteDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Trip plan' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Book the ' },
        { type: 'text', text: 'flight', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'hotel', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' via ' },
        { type: 'text', text: 'npm run trip', marks: [{ type: 'code' }] },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('passport')] }, { type: 'listItem', content: [p('charger')] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('book')] }, { type: 'listItem', content: [p('pack')] }] },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [p('renew passport')] },
        { type: 'taskItem', attrs: { checked: true }, content: [p('buy adapter')] },
      ],
    },
    { type: 'blockquote', content: [p('Travel light.')] },
    { type: 'codeBlock', attrs: { language: 'sh' }, content: [{ type: 'text', text: 'echo hi' }] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('City')] }, { type: 'tableHeader', content: [p('Nights')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Lisbon')] }, { type: 'tableCell', content: [p('3')] }] },
      ],
    },
  ],
};

describe('L4 plain-text projection (FTS / chunking / recall)', () => {
  it('includes checklist item text and table cell text so search still finds them', () => {
    const text = docToPlainText(RICH);
    expect(text).toContain('renew passport'); // checklist
    expect(text).toContain('buy adapter');
    expect(text).toContain('Lisbon'); // table cell
    expect(text).toContain('Nights'); // table header
    expect(text).toContain('echo hi'); // code block
    expect(text).toContain('Travel light.'); // quote
  });

  it('drops structural noise, keeping only readable lines', () => {
    expect(docToPlainText(RICH).split('\n')).toEqual([
      'Trip plan',
      'Book the flight and hotel via npm run trip',
      'passport',
      'charger',
      'book',
      'pack',
      'renew passport',
      'buy adapter',
      'Travel light.',
      'echo hi',
      'City Nights',
      'Lisbon 3',
    ]);
  });

  it('derives the title from the first non-empty line, as before', () => {
    expect(docTitle(RICH)).toBe('Trip plan');
    expect(docTitle({ type: 'doc', content: [p(''), p('Second line wins')] })).toBe('Second line wins');
  });
});

describe('L4 markdown export (every block type round-trips)', () => {
  const md = docToMarkdown(RICH);

  it('headings, marks, and links', () => {
    expect(md).toContain('# Trip plan');
    expect(md).toContain('**flight**');
    expect(md).toContain('*hotel*');
    expect(md).toContain('`npm run trip`');
    const linked = docToMarkdown({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] }] }],
    });
    expect(linked).toBe('[docs](https://x.dev)');
  });

  it('bullet, ordered, and checklist lists', () => {
    expect(md).toContain('- passport');
    expect(md).toContain('1. book');
    expect(md).toContain('2. pack');
    expect(md).toContain('- [ ] renew passport');
    expect(md).toContain('- [x] buy adapter');
  });

  it('quote, fenced code with language, and divider', () => {
    expect(md).toContain('> Travel light.');
    expect(md).toContain('```sh\necho hi\n```');
    expect(md).toContain('---');
  });

  it('tables as GFM with a header separator', () => {
    expect(md).toContain('| City | Nights |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Lisbon | 3 |');
  });

  it('an empty doc exports to an empty string', () => {
    expect(docToMarkdown({ type: 'doc', content: [p('')] })).toBe('');
  });
});

describe('L4 migration: plain text → doc', () => {
  it('wraps prose as paragraphs', () => {
    const doc = plainTextToDoc('First line\nSecond line');
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
    expect(docToPlainText(doc)).toBe('First line\nSecond line');
  });

  it('parses the 0008 To-dos migration lines back into real checklist items', () => {
    const doc = plainTextToDoc('To-dos\n- [ ] buy milk\n- [x] file taxes');
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'taskList']);
    expect(readChecklistFromDoc(doc)).toEqual([
      { checked: false, text: 'buy milk' },
      { checked: true, text: 'file taxes' },
    ]);
  });

  it('recognizes headings, bullets, and numbered lists', () => {
    const doc = plainTextToDoc('# Title\n- one\n- two\n1. first\n2. second');
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'bulletList', 'orderedList']);
    expect(doc.content[0]!.attrs).toEqual({ level: 1 });
  });

  it('text → doc keeps every word; markers live in markdown, not the mirror', () => {
    // The mirror feeds FTS/embedding, so it carries words without list syntax.
    // Structure is preserved by the doc itself and restored on markdown export.
    const doc = plainTextToDoc('Groceries\n- milk\n- eggs');
    expect(docToPlainText(doc)).toBe('Groceries\nmilk\neggs');
    expect(docToMarkdown(doc)).toBe('Groceries\n\n- milk\n- eggs');
  });

  it('parseDoc prefers stored JSON and falls back to the mirror when absent or corrupt', () => {
    expect(parseDoc(JSON.stringify(RICH), 'ignored')).toEqual(RICH);
    expect(docToPlainText(parseDoc(null, 'from mirror'))).toBe('from mirror');
    expect(docToPlainText(parseDoc('{not json', 'from mirror'))).toBe('from mirror');
    expect(docToPlainText(parseDoc('{"type":"paragraph"}', 'from mirror'))).toBe('from mirror'); // not a doc
  });
});

describe('L4.4 checklist append (the sanctioned To-dos replacement)', () => {
  it('creates a task list on a doc that has none', () => {
    const doc = appendChecklistItemToDoc({ type: 'doc', content: [p('Groceries')] }, 'buy milk');
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'taskList']);
    expect(readChecklistFromDoc(doc)).toEqual([{ checked: false, text: 'buy milk' }]);
  });

  it('appends into an existing trailing task list rather than starting a new one', () => {
    let doc = appendChecklistItemToDoc({ type: 'doc', content: [p('Groceries')] }, 'buy milk');
    doc = appendChecklistItemToDoc(doc, 'file taxes');
    expect(doc.content.filter((n) => n.type === 'taskList')).toHaveLength(1);
    expect(readChecklistFromDoc(doc).map((i) => i.text)).toEqual(['buy milk', 'file taxes']);
  });

  it('ignores a trailing empty paragraph the editor leaves behind', () => {
    const doc = appendChecklistItemToDoc({ type: 'doc', content: [p('Groceries'), p('')] }, 'buy milk');
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'taskList']);
  });

  it('appended items land in the projection, so they are searchable immediately', () => {
    const doc = appendChecklistItemToDoc(EMPTY, 'renew passport');
    expect(docToPlainText(doc)).toContain('renew passport');
    expect(docToMarkdown(doc)).toContain('- [ ] renew passport');
  });
});

const EMPTY: NoteDoc = { type: 'doc', content: [p('')] };

describe('L4 unicode safety (J4 parity)', () => {
  it('preserves emoji, CJK, and RTL through projection and export', () => {
    const doc: NoteDoc = { type: 'doc', content: [p('🎉 会議 مرحبا'), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('🚀 launch')] }] }] };
    expect(docToPlainText(doc)).toContain('🎉 会議 مرحبا');
    expect(docToPlainText(doc)).toContain('🚀 launch');
    expect(docToMarkdown(doc)).toContain('- [ ] 🚀 launch');
  });
});

describe('L4.4 title/body split', () => {
  it('round-trips a note with a heading title', () => {
    const doc = joinTitle('Groceries', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'milk' }] }] });
    const split = splitTitle(doc);
    expect(split.title).toBe('Groceries');
    expect(docToPlainText(split.body)).toBe('milk');
    expect(joinTitle(split.title, split.body)).toEqual(doc);
  });

  it('treats a leading paragraph as the title too, so old notes get one', () => {
    // Notes written before L4.4 (and every migrated to-do list) start with a
    // plain paragraph; that first line is what docTitle already showed.
    const doc: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Trip plan' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'book flights' }] },
      ],
    };
    const split = splitTitle(doc);
    expect(split.title).toBe('Trip plan');
    expect(docToPlainText(split.body)).toBe('book flights');
  });

  it('does not steal a list or table as the title', () => {
    const doc: NoteDoc = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] }],
    };
    const split = splitTitle(doc);
    expect(split.title).toBe('');
    expect(split.body).toEqual(doc); // body untouched
  });

  it('keeps an empty first block so a later title cannot promote a body line', () => {
    const joined = joinTitle('', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] });
    expect(joined.content[0]!.type).toBe('heading');
    expect(splitTitle(joined).title).toBe('');
    expect(docToPlainText(splitTitle(joined).body)).toBe('body');
  });

  it('never loses body content across an edit cycle', () => {
    const body: NoteDoc = {
      type: 'doc',
      content: [
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
      ],
    };
    let doc = joinTitle('A', body);
    for (const t of ['AB', 'ABC', '']) doc = joinTitle(t, splitTitle(doc).body);
    expect(docToPlainText(splitTitle(doc).body)).toBe(docToPlainText(body));
  });

  it('the title stays inside the doc, so it is still indexed for search', () => {
    const doc = joinTitle('Quarterly report', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft' }] }] });
    expect(docToPlainText(doc)).toContain('Quarterly report');
    expect(docTitle(doc)).toBe('Quarterly report');
  });
});
