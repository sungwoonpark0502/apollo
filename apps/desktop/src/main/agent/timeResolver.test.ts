import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { resolveTime } from './timeResolver';

const TZ = 'America/Los_Angeles';
// Reference now for all examples (C11): Saturday 2026-07-11 10:00, America/Los_Angeles.
const NOW = DateTime.fromObject({ year: 2026, month: 7, day: 11, hour: 10 }, { zone: TZ }).toJSDate();

function res(text: string) {
  return resolveTime(text, { now: NOW, tz: TZ });
}

function local(r: { iso: string } | null): string {
  if (!r) return 'NULL';
  return DateTime.fromISO(r.iso, { zone: TZ }).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** [input, expected local time, assumptionExpected?, rrule?] */
const GOLDEN: Array<[string, string, boolean?, string?]> = [
  // bare-hour rules
  ['tomorrow at 3', '2026-07-12T15:00', true],
  ['at 8', '2026-07-11T20:00', true],            // 8 AM already passed → 8 PM today, declare
  ['tomorrow at 9', '2026-07-12T09:00', true],   // bare 8..11 with explicit future day → AM
  ['at 11', '2026-07-11T11:00', true],           // 11 AM still future today → AM
  ['at 7', '2026-07-11T19:00', true],            // 1..7 → PM
  ['at 5', '2026-07-11T17:00', true],
  ['at 12', '2026-07-11T12:00'],
  ['at 9:30', '2026-07-11T21:30', true],         // 9:30 AM passed → PM today
  ['tomorrow at 15:30', '2026-07-12T15:30'],     // 24h form, no assumption

  // fixed phrases
  ['noon', '2026-07-11T12:00'],
  ['tonight', '2026-07-11T21:00'],
  ['this evening', '2026-07-11T19:00'],
  ['this afternoon', '2026-07-11T15:00'],
  ['in the morning', '2026-07-12T09:00'],        // 9 AM passed → tomorrow
  ['end of day', '2026-07-11T17:00'],
  ['by eod', '2026-07-11T17:00'],

  // weekdays (values normative: Friday & this Friday → 07-17, next Friday → 07-24)
  ['friday', '2026-07-17T09:00'],
  ['this friday', '2026-07-17T09:00'],
  ['next friday', '2026-07-24T09:00', true],     // always declare
  ['saturday', '2026-07-18T09:00'],              // today is Saturday, 'upcoming' rolls a week

  // weekend anchor = Saturday 10:00; already Saturday → today, declare
  ['this weekend', '2026-07-11T10:00', true],

  // deltas
  ['in 30 minutes', '2026-07-11T10:30'],
  ['in an hour', '2026-07-11T11:00'],
  ['in a bit', '2026-07-11T13:00', true],
  ['later', '2026-07-11T13:00', true],

  // months
  ['beginning of next month', '2026-08-01T09:00', true],

  // recurrence
  ['every weekday at 9', '2026-07-13T09:00', true, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],

  // roll-forward: explicit AM already past, no explicit date → next occurrence, declare
  ['at 9am', '2026-07-12T09:00', true],

  // fully explicit
  ['july 20 at 2pm', '2026-07-20T14:00'],
  ['tomorrow at 3pm', '2026-07-12T15:00'],
];

describe('timeResolver golden table (C11)', () => {
  for (const [input, expected, needsAssumption, rrule] of GOLDEN) {
    it(`"${input}" → ${expected}${rrule ? ` (${rrule})` : ''}`, () => {
      const r = res(input);
      expect(r, `no resolution for "${input}"`).not.toBeNull();
      expect(local(r)).toBe(expected);
      if (needsAssumption) expect(r?.assumption, 'assumption must be declared').toBeTruthy();
      if (rrule) expect(r?.rrule).toBe(rrule);
    });
  }

  it('returns null when no time expression exists', () => {
    expect(res('what is the capital of France')).toBeNull();
    expect(res('open spotify')).toBeNull();
  });

  it('counts at least 25 golden rows', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(25);
  });
});
