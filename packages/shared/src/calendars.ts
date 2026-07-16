import { type CalendarCollection } from './settings';

/**
 * I1/I7: local calendar color derivation. Calendar collections live in
 * Settings (calendars.active); event DTOs carry a derived `color` so every
 * surface renders the right dot/background without re-reading settings. Both
 * processes call configureCalendars at boot and on settings.changed, mirroring
 * the format.ts context pattern.
 */
export const DEFAULT_CALENDAR_ID = 'default';
export const DEFAULT_CALENDAR_COLOR = '#D97757';

/** Fixed palette (Apollo terracotta first). Google colors map to the nearest. */
export const CALENDAR_PALETTE: readonly string[] = [
  '#D97757', // terracotta (default)
  '#4C8BF5', // blue
  '#34A853', // green
  '#A142F4', // purple
  '#F4B400', // amber
  '#EA4335', // red
  '#00ACC1', // teal
  '#7986CB', // indigo
  '#8D6E63', // brown
  '#757575', // gray
];

let current: CalendarCollection[] = [
  { id: DEFAULT_CALENDAR_ID, name: 'Personal', color: DEFAULT_CALENDAR_COLOR, kind: 'local', readOnly: false },
];

export function configureCalendars(list: CalendarCollection[]): void {
  current = list.length > 0 ? list : current;
}

export function calendarsSnapshot(): CalendarCollection[] {
  return [...current];
}

export function calendarById(id: string, list: CalendarCollection[] = current): CalendarCollection | undefined {
  return list.find((c) => c.id === id);
}

/** The hex color for a calendar id, falling back to the default palette color. */
export function calendarColor(id: string, list: CalendarCollection[] = current): string {
  return calendarById(id, list)?.color ?? DEFAULT_CALENDAR_COLOR;
}

/** Nearest palette color to an arbitrary hex (used when mapping Google colors). */
export function nearestPaletteColor(hex: string): string {
  const target = parseHex(hex);
  if (!target) return DEFAULT_CALENDAR_COLOR;
  let best = CALENDAR_PALETTE[0]!;
  let bestDist = Infinity;
  for (const p of CALENDAR_PALETTE) {
    const c = parseHex(p)!;
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
