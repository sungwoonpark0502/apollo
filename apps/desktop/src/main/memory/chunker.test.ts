import { describe, expect, it } from 'vitest';
import { chunkFact, chunkMessage, chunkNote } from './chunker';

describe('chunkNote (G2)', () => {
  it('splits on blank lines and prepends the title to every chunk', () => {
    const note = 'Grocery list\n\nMilk and eggs.\n\nAlso bread.';
    const chunks = chunkNote(note);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const c of chunks) expect(c.startsWith('Grocery list')).toBe(true);
  });

  it('caps each chunk near 1000 chars', () => {
    const big = 'Title line\n\n' + 'word '.repeat(600); // ~3000 chars in one paragraph
    const chunks = chunkNote(big);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000 + 'Title line'.length + 1);
  });

  it('carries a 1-sentence overlap between chunks of a long note', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} has some sentences. The last sentence number ${i} ends here.`);
    const note = 'My Notes\n\n' + paras.join('\n\n') + '\n\n' + 'x'.repeat(1200);
    const chunks = chunkNote(note);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('empty content yields no chunks', () => {
    expect(chunkNote('')).toEqual([]);
    expect(chunkNote('   \n  ')).toEqual([]);
  });

  it('a note without blank lines is a single chunk (title == first line)', () => {
    const chunks = chunkNote('Just one line of text');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Just one line of text');
  });
});

describe('chunkMessage / chunkFact (G2)', () => {
  it('message is one chunk capped at 1000', () => {
    expect(chunkMessage('hello there')).toEqual(['hello there']);
    expect(chunkMessage('x'.repeat(2000))[0]).toHaveLength(1000);
    expect(chunkMessage('   ')).toEqual([]);
  });
  it('fact is one chunk prefixed with category', () => {
    expect(chunkFact('person', 'partner lives in Columbus')).toEqual(['person: partner lives in Columbus']);
    expect(chunkFact('place', '')).toEqual([]);
  });
});
