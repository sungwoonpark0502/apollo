import { describe, expect, it } from 'vitest';
import { createChunker } from './chunker';

function collect(): { sentences: string[]; push: (s: string) => void } {
  const sentences: string[] = [];
  return { sentences, push: (s) => sentences.push(s) };
}

describe('chunker (C12.5)', () => {
  it('flushes complete sentences from streamed tokens', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    for (const tok of ['The timer ', 'is set for five ', 'minutes. It will ', 'ring at noon. ']) c.feed(tok);
    expect(sentences).toEqual(['The timer is set for five minutes.', 'It will ring at noon.']);
  });

  it('C21 case: paragraph with abbreviations and decimals → expected sentence list', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('Dr. Smith arrives at 3.5 p.m. sharp, e.g. right after Mr. Jones. Bring the U.S. papers. The fee is 12.50 dollars total. ');
    c.end();
    expect(sentences).toEqual([
      'Dr. Smith arrives at 3.5 p.m. sharp, e.g. right after Mr. Jones.',
      'Bring the U.S. papers.',
      'The fee is 12.50 dollars total.',
    ]);
  });

  it('respects the 15-char minimum by merging tiny fragments forward', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('No. Wait, that is fine now. ');
    c.end();
    expect(sentences).toEqual(['No. Wait, that is fine now.']);
  });

  it('handles quotes and brackets after terminators', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('She said "stop right there." Then everyone left the room. ');
    c.end();
    expect(sentences).toEqual(['She said "stop right there."', 'Then everyone left the room.']);
  });

  it('force-flushes at 220 chars without a terminator', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('word '.repeat(50)); // 250 chars, no terminator
    expect(sentences).toHaveLength(1);
    expect(sentences[0]!.length).toBeGreaterThanOrEqual(220);
  });

  it('final flush emits the trailing fragment', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('Sure, opening Spotify now');
    expect(sentences).toHaveLength(0);
    c.end();
    expect(sentences).toEqual(['Sure, opening Spotify now']);
  });

  it('a terminator at buffer end waits for the stream unless end() is called', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    c.feed('It is ready at 5 p.m.');
    expect(sentences).toHaveLength(0); // "p.m." could continue
    c.end();
    expect(sentences).toEqual(['It is ready at 5 p.m.']);
  });

  it('first flush is immediate once a sentence completes (<50ms, C21.4)', () => {
    const { sentences, push } = collect();
    const c = createChunker(push);
    const t0 = performance.now();
    c.feed('Here is your timer, all set. ');
    const dt = performance.now() - t0;
    expect(sentences).toHaveLength(1);
    expect(dt).toBeLessThan(50);
  });
});
