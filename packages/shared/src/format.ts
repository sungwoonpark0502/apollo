import { DateTime } from 'luxon';

/**
 * I2 (Phase 9): the single source for all human-facing date, time, number,
 * relative-time, and duration formatting. Every card, view, tool, and spoken
 * template routes display formatting through here so 12h/24h and locale changes
 * are consistent everywhere. A custom ESLint rule forbids toLocaleTimeString,
 * toLocaleDateString, and DateTime.prototype.toFormat outside this file and
 * tests, so this module is also the only place machine wire formats (ICS date
 * keys, month buckets) are produced.
 *
 * Backed by Intl (via luxon .toLocaleString) with the effective locale
 * (locale.region ?? app.getLocale()/navigator.language) and profile
 * timeFormat/weekStart. Both processes call configureFormat once at boot and
 * again on every settings.changed push.
 */
export interface FormatContext {
  locale: string; // BCP-47, e.g. "en-US"
  timeFormat: '12h' | '24h';
  weekStart: 'monday' | 'sunday';
}

let current: FormatContext = { locale: 'en-US', timeFormat: '12h', weekStart: 'sunday' };

/** Update the process-wide default context (boot + settings.changed). */
export function configureFormat(ctx: Partial<FormatContext>): void {
  current = { ...current, ...ctx };
}

/** The active default context; weekStart is read here by calendar grid layout. */
export function formatContext(): FormatContext {
  return { ...current };
}

type Ctx = Partial<FormatContext> | undefined;
function resolve(ctx: Ctx): FormatContext {
  return ctx ? { ...current, ...ctx } : current;
}

/** Normalize ICU's narrow/no-break spaces (e.g. before AM/PM) to plain spaces
 *  so rendered, copied, and spoken strings are predictable across platforms. */
function norm(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, ' ');
}

function timeOpts(c: FormatContext): Intl.DateTimeFormatOptions {
  return c.timeFormat === '12h'
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hour12: false };
}

/** Curated date shapes actually used across Apollo's surfaces. */
export type DateStyle =
  | 'weekday-short' // "Mon"
  | 'weekday-long' // "Monday"
  | 'weekday-day' // "Mon 15"
  | 'date' // "Jul 15"
  | 'short' // "7/15/2026"
  | 'weekday-date' // "Mon, Jul 15"
  | 'full' // "Monday, July 15"
  | 'weekday-full' // "Monday, Jul 15"
  | 'month-year'; // "July 2026"

const DATE_OPTS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  'weekday-short': { weekday: 'short' },
  'weekday-long': { weekday: 'long' },
  'weekday-day': { weekday: 'short', day: 'numeric' },
  date: { month: 'short', day: 'numeric' },
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  'weekday-date': { weekday: 'short', month: 'short', day: 'numeric' },
  full: { weekday: 'long', month: 'long', day: 'numeric' },
  'weekday-full': { weekday: 'long', month: 'short', day: 'numeric' },
  'month-year': { month: 'long', year: 'numeric' },
};

interface WhenOpts {
  tz?: string;
  ctx?: Ctx;
}

function dt(ms: number, tz: string | undefined, c: FormatContext): DateTime {
  return DateTime.fromMillis(ms, tz ? { zone: tz } : {}).setLocale(c.locale);
}

/** "9:00 AM" (12h) or "09:00" (24h). */
export function fmtTime(ms: number, opts: WhenOpts = {}): string {
  const c = resolve(opts.ctx);
  return norm(dt(ms, opts.tz, c).toLocaleString(timeOpts(c)));
}

/** An hour-of-day axis label: "9 AM"/"9AM" (12h) or "09" (24h). */
export function fmtHour(hour: number, ctx?: Ctx): string {
  const c = resolve(ctx);
  if (c.timeFormat === '24h') return String(hour).padStart(2, '0');
  const base = DateTime.fromObject({ hour }).setLocale(c.locale);
  return norm(base.toLocaleString({ hour: 'numeric', hour12: true }));
}

/** A date rendered in one of the curated styles. */
export function fmtDate(ms: number, style: DateStyle, opts: WhenOpts = {}): string {
  const c = resolve(opts.ctx);
  return norm(dt(ms, opts.tz, c).toLocaleString(DATE_OPTS[style]));
}

/** A date rendered from an ISO calendar day (no time component). */
export function fmtDateIso(dateIso: string, style: DateStyle, ctx?: Ctx): string {
  const c = resolve(ctx);
  return norm(DateTime.fromISO(dateIso).setLocale(c.locale).toLocaleString(DATE_OPTS[style]));
}

interface DateTimeOpts extends WhenOpts {
  /** date portion style; defaults to 'weekday-date'. */
  dateStyle?: Extract<DateStyle, 'date' | 'weekday-date' | 'full' | 'weekday-full'>;
}

/** "Mon, Jul 15, 9:00 AM" — a date + time in one locale-correct string. */
export function fmtDateTime(ms: number, opts: DateTimeOpts = {}): string {
  const c = resolve(opts.ctx);
  return norm(dt(ms, opts.tz, c).toLocaleString({ ...DATE_OPTS[opts.dateStyle ?? 'weekday-date'], ...timeOpts(c) }));
}

/** A start–end time range on a single day: "9:00 AM – 10:00 AM"; open-ended → just the start. */
export function fmtRange(startMs: number, endMs: number | null, opts: WhenOpts = {}): string {
  const start = fmtTime(startMs, opts);
  if (endMs == null) return start;
  return `${start} – ${fmtTime(endMs, opts)}`;
}

/** Relative phrasing: "in 45 min", "3 days ago". */
export function fmtRelative(ms: number, nowMs: number = Date.now(), ctx?: Ctx): string {
  const c = resolve(ctx);
  const rtf = new Intl.RelativeTimeFormat(c.locale, { numeric: 'auto', style: 'short' });
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  for (const [unit, span] of units) {
    if (abs >= span || unit === 'second') {
      return norm(rtf.format(Math.round(diff / span), unit)).replace(/\.$/, '');
    }
  }
  return norm(rtf.format(0, 'second'));
}

interface NumberOpts {
  ctx?: Ctx;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

/** Locale-grouped number: 12345 → "12,345" (en-US) / "12.345" (de-DE). */
export function fmtNumber(n: number, opts: NumberOpts = {}): string {
  const c = resolve(opts.ctx);
  return new Intl.NumberFormat(c.locale, {
    maximumFractionDigits: opts.maximumFractionDigits,
    minimumFractionDigits: opts.minimumFractionDigits,
  }).format(n);
}

/** Compact duration from milliseconds: "1h 30m", "45m", "2h", "30s". */
export function fmtDuration(ms: number): string {
  const totalSec = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && !m) parts.push(`${s}s`);
  return parts.join(' ');
}

// ---- Machine wire formats (not display, but centralized so the lint rule can
// forbid stray .toFormat everywhere else) ----

/** Local calendar date key "YYYY-MM-DD" in a timezone. */
export function localDateKey(ms: number, tz?: string): string {
  return DateTime.fromMillis(ms, tz ? { zone: tz } : {}).toFormat('yyyy-LL-dd');
}

/** Local month bucket "YYYY-MM" (usage aggregation). */
export function monthKey(ms: number, tz?: string): string {
  return DateTime.fromMillis(ms, tz ? { zone: tz } : {}).toFormat('yyyy-LL');
}

/** ICS all-day date "YYYYMMDD". */
export function icsDate(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat('yyyyLLdd');
}

/** ICS floating date-time "YYYYMMDDTHHMMSS". */
export function icsDateTime(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyyLLdd'T'HHmmss");
}
