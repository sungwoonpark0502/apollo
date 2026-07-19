import { describe, expect, it } from 'vitest';
import { chunkFact, chunkMessage, chunkNote } from './chunker';

const CAP = 1000;

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (!(s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

describe('J4 large-input chunking (no OOM, within caps)', () => {
  // 30s test timeout: chunking 5MB is real CPU work and the default 5s budget
  // is too tight on a loaded CI runner. The in-test bound below is the actual
  // hang detector.
  it('a ~5MB single-paragraph note chunks within caps and stays bounded', () => {
    const big = 'lorem ipsum '.repeat(450_000); // ~5.4MB, no blank lines
    const t0 = Date.now();
    const chunks = chunkNote(big);
    // Hang detection, not a perf benchmark: generous bound so parallel-suite
    // machine load can't flake it (it sat at 4001ms vs a 4000ms budget once).
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(chunks.length).toBeGreaterThan(1000);
    // each chunk is within the cap (+ prepended title budget)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CAP + 81);
    // total content is not silently dropped beyond a sane multiple of the input
    expect(chunks.length).toBeLessThan(big.length / 100);
  }, 30_000);

  it('a 5MB note made of emoji chunks without ever splitting a surrogate pair', () => {
    const big = '😀'.repeat(200_000); // 400k UTF-16 units of astral chars
    const chunks = chunkNote(big);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(hasLoneSurrogate(c)).toBe(false);
  });

  it('message and fact chunkers cap a huge single input at CAP, surrogate-safe', () => {
    const bigEmoji = '🎉'.repeat(5000);
    expect(chunkMessage(bigEmoji)[0]!.length).toBeLessThanOrEqual(CAP);
    expect(hasLoneSurrogate(chunkMessage(bigEmoji)[0]!)).toBe(false);
    expect(chunkFact('cat', bigEmoji)[0]!.length).toBeLessThanOrEqual(CAP);
    expect(hasLoneSurrogate(chunkFact('cat', bigEmoji)[0]!)).toBe(false);
  });
});

describe('J4 unicode & emoji chunking', () => {
  it('CJK, RTL, combining, and emoji titles chunk and prepend without corruption', () => {
    const samples = [
      '日本語のノート\n\n本文の内容です。',
      'مرحبا بالعالم\n\nمحتوى عربي هنا',
      'Café ☕ é̂ note\n\nbody with 👨‍👩‍👧‍👦 family',
      '🎉🎊 Party plans\n\nInvite everyone',
    ];
    for (const s of samples) {
      const chunks = chunkNote(s);
      expect(chunks.length).toBeGreaterThan(0);
      for (const c of chunks) expect(hasLoneSurrogate(c)).toBe(false);
    }
  });
});
