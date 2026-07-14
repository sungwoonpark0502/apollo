/**
 * G2 chunking. Notes: split on blank lines, each chunk capped at 1000 chars with
 * a 1-sentence overlap; the title line (first non-empty line) is prepended to
 * every chunk for context. Messages: one chunk per message, capped 1000. Facts:
 * one chunk each, prefixed with category.
 */
const CAP = 1000;

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t.slice(0, 80);
  }
  return '';
}

/** Last sentence of a string (for 1-sentence overlap between chunks). */
function lastSentence(text: string): string {
  const parts = text.trim().match(/[^.!?]*[.!?]+|\S[^.!?]*$/g);
  return parts && parts.length ? (parts[parts.length - 1] as string).trim() : '';
}

/** Split into paragraphs on blank lines, then pack into <=CAP chunks with 1-sentence overlap. */
function packParagraphs(paras: string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const para of paras) {
    const block = para.trim();
    if (!block) continue;
    if (cur && (cur.length + block.length + 2 > CAP)) {
      chunks.push(cur.trim());
      const overlap = lastSentence(cur);
      cur = overlap && overlap.length < CAP / 2 ? `${overlap} ` : '';
    }
    // a single oversized paragraph is hard-split at CAP
    let remaining = block;
    while ((cur.length + remaining.length) > CAP) {
      const room = CAP - cur.length;
      cur += remaining.slice(0, room);
      chunks.push(cur.trim());
      const overlap = lastSentence(cur);
      remaining = remaining.slice(room);
      cur = overlap && overlap.length < CAP / 2 ? `${overlap} ` : '';
    }
    cur += (cur ? '\n' : '') + remaining;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Chunk a note; title prepended to every chunk. Returns [] for empty content. */
export function chunkNote(content: string): string[] {
  if (!content.trim()) return [];
  const title = firstNonEmptyLine(content);
  const paras = content.split(/\n\s*\n/);
  const packed = packParagraphs(paras);
  return packed.map((c) => (title && !c.startsWith(title) ? `${title}\n${c}` : c)).map((c) => c.slice(0, CAP + title.length + 1));
}

/** One chunk per message, capped at CAP. */
export function chunkMessage(content: string): string[] {
  const t = content.trim();
  if (!t) return [];
  return [t.slice(0, CAP)];
}

/** One chunk per fact, prefixed with its category. */
export function chunkFact(category: string, fact: string): string[] {
  const t = fact.trim();
  if (!t) return [];
  return [`${category}: ${t}`.slice(0, CAP)];
}
