import { describe, expect, it } from 'vitest';
import {
  configureFormat,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtHour,
  fmtNumber,
  fmtRange,
  fmtRelative,
  fmtTime,
  formatContext,
  icsDate,
  icsDateTime,
  localDateKey,
  monthKey,
  type FormatContext,
} from './format';

// 2026-07-15T09:05:00Z ; use UTC tz so zone math is deterministic in CI.
const T = Date.UTC(2026, 6, 15, 9, 5, 0);
const TZ = 'UTC';

const enUS12: FormatContext = { locale: 'en-US', timeFormat: '12h', weekStart: 'sunday' };
const enUS24: FormatContext = { locale: 'en-US', timeFormat: '24h', weekStart: 'monday' };
const enGB12: FormatContext = { locale: 'en-GB', timeFormat: '12h', weekStart: 'monday' };
const enGB24: FormatContext = { locale: 'en-GB', timeFormat: '24h', weekStart: 'monday' };

describe('format.ts golden matrix', () => {
  it('fmtTime across 12h/24h × en-US/en-GB', () => {
    expect(fmtTime(T, { tz: TZ, ctx: enUS12 })).toBe('9:05 AM');
    expect(fmtTime(T, { tz: TZ, ctx: enUS24 })).toBe('09:05');
    expect(fmtTime(T, { tz: TZ, ctx: enGB12 })).toBe('9:05 am');
    expect(fmtTime(T, { tz: TZ, ctx: enGB24 })).toBe('09:05');
  });

  it('fmtDate styles are locale-correct', () => {
    expect(fmtDate(T, 'weekday-short', { tz: TZ, ctx: enUS12 })).toBe('Wed');
    expect(fmtDate(T, 'date', { tz: TZ, ctx: enUS12 })).toBe('Jul 15');
    expect(fmtDate(T, 'date', { tz: TZ, ctx: enGB12 })).toBe('15 Jul');
    expect(fmtDate(T, 'month-year', { tz: TZ, ctx: enUS12 })).toBe('July 2026');
    expect(fmtDate(T, 'full', { tz: TZ, ctx: enUS12 })).toBe('Wednesday, July 15');
  });

  it('fmtDateTime combines date + time per locale/hour cycle', () => {
    expect(fmtDateTime(T, { tz: TZ, ctx: enUS12, dateStyle: 'weekday-date' })).toBe('Wed, Jul 15, 9:05 AM');
    expect(fmtDateTime(T, { tz: TZ, ctx: enGB24, dateStyle: 'date' })).toBe('15 Jul, 09:05');
  });

  it('fmtRange renders a same-day time span; open-ended → start only', () => {
    const end = T + 60 * 60 * 1000;
    expect(fmtRange(T, end, { tz: TZ, ctx: enUS12 })).toBe('9:05 AM – 10:05 AM');
    expect(fmtRange(T, end, { tz: TZ, ctx: enUS24 })).toBe('09:05 – 10:05');
    expect(fmtRange(T, null, { tz: TZ, ctx: enUS12 })).toBe('9:05 AM');
  });

  it('fmtHour axis label honors hour cycle', () => {
    expect(fmtHour(9, enUS12)).toBe('9 AM');
    expect(fmtHour(9, enUS24)).toBe('09');
    expect(fmtHour(14, enUS24)).toBe('14');
  });

  it('fmtRelative gives human phrasing both directions', () => {
    const now = T;
    expect(fmtRelative(T + 45 * 60 * 1000, now, enUS12)).toBe('in 45 min');
    expect(fmtRelative(T - 3 * 86_400_000, now, enUS12)).toBe('3 days ago');
    expect(fmtRelative(T, now, enUS12)).toBe('now');
  });

  it('fmtNumber groups per locale', () => {
    expect(fmtNumber(12345, { ctx: enUS12 })).toBe('12,345');
    expect(fmtNumber(12345, { ctx: { locale: 'de-DE', timeFormat: '24h', weekStart: 'monday' } })).toBe('12.345');
  });

  it('fmtDuration is compact', () => {
    expect(fmtDuration(90 * 60 * 1000)).toBe('1h 30m');
    expect(fmtDuration(45 * 60 * 1000)).toBe('45m');
    expect(fmtDuration(2 * 60 * 60 * 1000)).toBe('2h');
    expect(fmtDuration(30 * 1000)).toBe('30s');
  });

  it('machine wire formats are stable', () => {
    expect(localDateKey(T, TZ)).toBe('2026-07-15');
    expect(monthKey(T, TZ)).toBe('2026-07');
    expect(icsDate(T, TZ)).toBe('20260715');
    expect(icsDateTime(T, TZ)).toBe('20260715T090500');
  });
});

describe('configureFormat default context', () => {
  it('applies the process-wide default when no ctx override is passed', () => {
    const before = formatContext();
    configureFormat({ locale: 'en-GB', timeFormat: '24h' });
    expect(fmtTime(T, { tz: TZ })).toBe('09:05');
    expect(formatContext().locale).toBe('en-GB');
    // restore so test order can't leak
    configureFormat(before);
    expect(fmtTime(T, { tz: TZ })).toBe('9:05 AM');
  });
});
