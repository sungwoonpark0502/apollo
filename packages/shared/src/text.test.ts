import { describe, expect, it } from 'vitest';
import { graphemeCount, truncateGraphemes } from './text';

// A lone half of a surrogate pair is the failure mode we must never produce.
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true; // high surrogate not followed by low
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low surrogate without a preceding high
    }
  }
  return false;
}

describe('J4 grapheme-safe truncation', () => {
  it('never splits a surrogate pair (emoji)', () => {
    const emoji = '😀'.repeat(10); // each emoji is 2 UTF-16 units
    for (let n = 0; n <= 20; n++) {
      const out = truncateGraphemes(emoji, n);
      expect(hasLoneSurrogate(out), `n=${n}`).toBe(false);
      expect(out.length).toBeLessThanOrEqual(n);
      expect(out.length % 2).toBe(0); // whole emoji only
    }
  });

  it('never splits a combining sequence (family/ZWJ + combining marks)', () => {
    const family = '👨‍👩‍👧‍👦'; // ZWJ sequence, one grapheme, many code units
    const combining = 'é̂'; // e + two combining accents = one grapheme
    expect(truncateGraphemes(family + family, 1)).not.toContain('‍'); // no dangling ZWJ
    // truncating mid-combining returns nothing or the whole cluster, never a partial
    const t = truncateGraphemes(combining, 1);
    expect(t === '' || t === combining).toBe(true);
  });

  it('leaves short strings untouched and respects the cap for ASCII', () => {
    expect(truncateGraphemes('hello', 80)).toBe('hello');
    expect(truncateGraphemes('hello world', 5)).toBe('hello');
  });

  it('handles CJK and RTL without corruption', () => {
    expect(hasLoneSurrogate(truncateGraphemes('日本語のテキスト', 4))).toBe(false);
    expect(hasLoneSurrogate(truncateGraphemes('مرحبا بالعالم', 5))).toBe(false);
  });

  it('graphemeCount counts user-perceived characters', () => {
    expect(graphemeCount('😀😀')).toBe(2);
    expect(graphemeCount('👨‍👩‍👧‍👦')).toBe(1);
    expect(graphemeCount('abc')).toBe(3);
  });
});
