import { type CardPayload } from '@apollo/shared';

/**
 * E4 Response Stage helpers. Triggering, sentence→row mapping (best-effort, must
 * never throw), and stagger timing are pure so they can be unit-tested.
 */

/** A voice-source card of one of these kinds renders in Stage mode (E4). */
export function isStageCard(card: CardPayload, source: 'voice' | 'text'): boolean {
  if (source !== 'voice') return false;
  return card.kind === 'brief' || card.kind === 'newsList' || card.kind === 'weather' || card.kind === 'eventList';
}

/** Number of highlightable rows for a Stage card (news items / brief sections). */
export function stageRowCount(card: CardPayload): number {
  if (card.kind === 'newsList') return card.items.length;
  if (card.kind === 'brief') return card.sections.length;
  if (card.kind === 'eventList') return card.events.length;
  return 0;
}

/**
 * Maps the index of the sentence currently being spoken to a row index.
 * Best-effort: if there are no rows or the mapping is ambiguous, returns null
 * (show no highlight). Never throws (E4).
 */
export function sentenceToRow(sentenceIndex: number, rowCount: number, sentenceCount: number): number | null {
  try {
    if (rowCount <= 0) return null;
    if (sentenceIndex < 0) return null;
    // Common case: one lead-in sentence then one sentence per row.
    if (sentenceCount === rowCount + 1) {
      const row = sentenceIndex - 1;
      return row >= 0 && row < rowCount ? row : null;
    }
    // One sentence per row.
    if (sentenceCount === rowCount) {
      return sentenceIndex < rowCount ? sentenceIndex : null;
    }
    // Otherwise proportional, but only if it lands cleanly; else no highlight.
    if (sentenceCount <= 0) return null;
    const row = Math.floor((sentenceIndex / sentenceCount) * rowCount);
    return row >= 0 && row < rowCount ? row : null;
  } catch {
    return null;
  }
}

/** Stage context title for the header (E4). */
export function stageTitle(
  card: CardPayload,
  strings: { morningBrief: string; weatherIn: (p: string) => string; news: string; schedule: string },
): string {
  switch (card.kind) {
    case 'brief':
      return strings.morningBrief;
    case 'weather':
      return strings.weatherIn(card.place);
    case 'newsList':
      return strings.news;
    case 'eventList':
      return strings.schedule;
    default:
      return '';
  }
}

/** Deep-link target for a Stage card's "Open in Apollo" (E4). */
export function stageDeepLink(card: CardPayload): { view: 'today' | 'calendar' | 'notes'; dateIso?: string } | null {
  if (card.kind === 'brief') return { view: 'today' };
  if (card.kind === 'eventList') {
    const first = card.events[0];
    const dateIso = first ? new Date(first.startTs).toISOString().slice(0, 10) : undefined;
    return { view: 'calendar', ...(dateIso ? { dateIso } : {}) };
  }
  if (card.kind === 'weather') return { view: 'today' };
  return null; // newsList rows open in the external browser, handled per-row
}
