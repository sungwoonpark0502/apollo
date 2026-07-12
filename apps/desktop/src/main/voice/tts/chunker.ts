/**
 * C12.5 sentence chunker: buffers streamed tokens, flushes a sentence when a
 * terminator [.!?]["')\]]? is followed by whitespace/end, buffer >= 15 chars,
 * guarded against abbreviations and decimals; force-flush at 220 chars; final
 * flush at stream end.
 */
const MIN_FLUSH = 15;
const FORCE_FLUSH = 220;

const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'dr.', 'st.', 'vs.', 'e.g.', 'i.e.', 'etc.', 'a.m.', 'p.m.', 'u.s.',
  'ms.', 'jr.', 'sr.', 'prof.', 'inc.', 'no.', 'dept.', 'approx.',
]);

/** Index just past a valid sentence terminator, or -1. atStreamEnd treats buffer end as whitespace. */
function findSentenceEnd(buf: string, atStreamEnd: boolean): number {
  const re = /[.!?]["')\]]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf)) !== null) {
    const end = m.index + m[0].length;
    const next = buf[end];
    const followedOk = next === undefined ? atStreamEnd : /\s/.test(next);
    if (!followedOk) continue;

    const lastWord = buf.slice(0, m.index + 1).toLowerCase().match(/(\S+)$/)?.[1] ?? '';
    if (ABBREVIATIONS.has(lastWord)) continue;
    if (/^[b-z]\.$/.test(lastWord)) continue; // single initials like "J." (but "a." is a word)
    if (/\d\.$/.test(buf.slice(0, m.index + 1)) && next !== undefined && /\d/.test(next)) continue; // decimal 3.5

    return end;
  }
  return -1;
}

export function createChunker(onSentence: (sentence: string) => void) {
  let buf = '';

  function scan(atStreamEnd: boolean): void {
    for (;;) {
      const end = findSentenceEnd(buf, atStreamEnd);
      if (end === -1) break;
      const sentence = buf.slice(0, end).trim();
      if (sentence.length < MIN_FLUSH) {
        // too short: wait for more unless another terminator later completes it
        const rest = findSentenceEnd(buf.slice(end), atStreamEnd);
        if (rest === -1) break;
        const longer = buf.slice(0, end + rest).trim();
        onSentence(longer);
        buf = buf.slice(end + rest).replace(/^\s+/, '');
        continue;
      }
      onSentence(sentence);
      buf = buf.slice(end).replace(/^\s+/, '');
    }
    if (buf.length >= FORCE_FLUSH) {
      onSentence(buf.trim());
      buf = '';
    }
  }

  return {
    feed(tokens: string): void {
      buf += tokens;
      scan(false);
    },
    /** Stream ended: flush whatever remains. */
    end(): void {
      scan(true);
      const rest = buf.trim();
      buf = '';
      if (rest) onSentence(rest);
    },
    reset(): void {
      buf = '';
    },
    pending(): string {
      return buf;
    },
  };
}

export type Chunker = ReturnType<typeof createChunker>;
