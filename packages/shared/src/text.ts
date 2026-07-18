/**
 * J4 unicode-safe text helpers. Truncating with String.prototype.slice cuts on
 * UTF-16 code units, which splits surrogate pairs (emoji) and combining
 * sequences, producing broken glyphs in snippets/titles and half-characters at
 * chunk boundaries. These truncate on grapheme-cluster boundaries instead.
 */
let segmenter: Intl.Segmenter | null = null;
function graphemeSegmenter(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter;
}

/**
 * Truncate to at most `maxUnits` UTF-16 code units WITHOUT splitting a grapheme
 * cluster (surrogate pair or combining sequence). The result is always ≤
 * maxUnits and ends on a grapheme boundary.
 */
export function truncateGraphemes(input: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (input.length <= maxUnits) return input;
  // Only segment a small prefix — never the whole (possibly multi-MB) input.
  // A normal grapheme is a few code units; +32 comfortably captures the boundary.
  const window = input.slice(0, maxUnits + 32);
  let out = '';
  for (const { segment } of graphemeSegmenter().segment(window)) {
    if (out.length + segment.length > maxUnits) break;
    out += segment;
  }
  return out;
}

/** Grapheme count (user-perceived characters), for length checks that respect emoji. */
export function graphemeCount(input: string): number {
  let n = 0;
  for (const _ of graphemeSegmenter().segment(input)) n++;
  return n;
}
