import { DateTime } from 'luxon';
import * as rrulePkg from 'rrule';

// rrule ships CJS; under the renderer's ESM the classes live on the default export.
const { RRule } = (rrulePkg as { default?: typeof rrulePkg }).default ?? rrulePkg;

/**
 * E3.2 recurrence presets for the event editor. Pure string builders + a live
 * validator so the editor can show inline errors. Weekday/day are derived from
 * the event's own start so "Weekly on {weekday}" matches what the user sees.
 */
export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** RRULE string for a preset, given the event's start (for weekday/day-of-month). */
export function buildRRule(preset: RecurrencePreset, startIso: string, customText = ''): string | null {
  const dt = DateTime.fromISO(startIso);
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${BYDAY[(dt.weekday - 1 + 7) % 7]}`;
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${dt.day}`;
    case 'custom':
      return customText.trim() ? customText.trim().replace(/^RRULE:/i, '') : null;
  }
}

/** Detects which preset an existing RRULE matches (for editing), else 'custom'. */
export function detectPreset(rrule: string | null, startIso: string): RecurrencePreset {
  if (!rrule) return 'none';
  const norm = rrule.trim().replace(/^RRULE:/i, '').toUpperCase();
  if (norm === 'FREQ=DAILY') return 'daily';
  if (norm === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  const dt = DateTime.fromISO(startIso);
  if (norm === `FREQ=WEEKLY;BYDAY=${BYDAY[(dt.weekday - 1 + 7) % 7]}`) return 'weekly';
  if (norm === `FREQ=MONTHLY;BYMONTHDAY=${dt.day}`) return 'monthly';
  return 'custom';
}

/** True if `text` parses as a valid RRULE (E3.2 live validation). */
export function isValidRRule(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  try {
    const opts = RRule.parseString(t.replace(/^RRULE:/i, ''));
    if (!opts.freq && opts.freq !== 0) return false;
    // constructing forces validation of the full option set
    new RRule({ ...opts, dtstart: new Date(Date.UTC(2026, 0, 1)) });
    return true;
  } catch {
    return false;
  }
}
