import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { fmtDate, fmtDateTime } from '@apollo/shared';

/**
 * English time resolution with the C11 normative overrides layered over
 * chrono-node. The reference resolver for fast path and tests; the system
 * prompt mirrors its behavior. Assumptions must surface in the reply.
 */
export interface ResolvedTime {
  iso: string;              // ISO 8601 in the user's zone
  assumption?: string;      // human sentence, e.g. "assumed 3 PM"
  rrule?: string;           // present for recurring expressions
}

export interface ResolveOpts {
  now: Date;
  tz: string;
}

const WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};

function fmt(dt: DateTime): string {
  return dt.toISO({ suppressMilliseconds: true }) ?? '';
}

function fmtHuman(dt: DateTime): string {
  return fmtDateTime(dt.toMillis(), { tz: dt.zoneName ?? undefined, dateStyle: 'weekday-date' });
}

/** Upcoming occurrence of a weekday, strictly after today unless allowToday. */
function upcomingWeekday(now: DateTime, iso: number, allowToday = false): DateTime {
  let delta = (iso - now.weekday + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  return now.plus({ days: delta }).startOf('day');
}

function withTime(day: DateTime, hour: number, minute = 0): DateTime {
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

/**
 * Bare-hour meridiem rules (C11): 1..7 → PM; 8..11 → AM if still future on an
 * explicit future day or today, else PM today; 12 → noon.
 */
function disambiguateBareHour(hour: number, minute: number, day: DateTime, now: DateTime, explicitFutureDay: boolean): { dt: DateTime; assumption: string } {
  if (hour === 12) return { dt: withTime(day, 12, minute), assumption: '' };
  if (hour >= 1 && hour <= 7) {
    const dt = withTime(day, hour + 12, minute);
    return { dt, assumption: `assumed ${fmtHuman(dt)}` };
  }
  // 8..11
  if (explicitFutureDay) {
    const dt = withTime(day, hour, minute);
    return { dt, assumption: `assumed ${fmtHuman(dt)}` };
  }
  const am = withTime(day, hour, minute);
  const dt = am > now ? am : withTime(day, hour + 12, minute);
  return { dt, assumption: `assumed ${fmtHuman(dt)}` };
}

export function resolveTime(text: string, opts: ResolveOpts): ResolvedTime | null {
  const tz = opts.tz;
  const now = DateTime.fromJSDate(opts.now, { zone: tz });
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');

  // --- recurring: "every weekday at 9", "every day at 7", "every monday at 8" ---
  {
    const m = t.match(/\bevery (weekday|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?( at (\d{1,2})(:(\d{2}))?( ?(am|pm))?)?\b/);
    if (m) {
      const hourRaw = m[3] ? parseInt(m[3], 10) : 9;
      const minute = m[5] ? parseInt(m[5], 10) : 0;
      const mer = m[7];
      let hour = hourRaw;
      let assumption: string | undefined;
      if (mer === 'pm' && hourRaw < 12) hour = hourRaw + 12;
      else if (mer === 'am') hour = hourRaw === 12 ? 0 : hourRaw;
      else if (!mer) {
        if (hourRaw >= 1 && hourRaw <= 7) {
          // recurring daily-morning convention: keep small hours as given only when clearly evening words absent; C11 example "every weekday at 9" → 09:00
          hour = hourRaw + 12;
          assumption = `assumed ${hourRaw} PM`;
        } else {
          hour = hourRaw; // 8..11 → AM for recurrences
          assumption = `assumed ${hourRaw} AM`;
        }
      }
      let rrule: string;
      let first: DateTime;
      if (m[1] === 'weekday') {
        rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
        first = withTime(now, hour, minute);
        while (first <= now || first.weekday > 5) first = withTime(first.plus({ days: 1 }), hour, minute);
      } else if (m[1] === 'day') {
        rrule = 'FREQ=DAILY';
        first = withTime(now, hour, minute);
        if (first <= now) first = first.plus({ days: 1 });
      } else {
        const wd = WEEKDAYS[m[1] as string] as number;
        const BY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][wd - 1];
        rrule = `FREQ=WEEKLY;BYDAY=${BY}`;
        first = withTime(upcomingWeekday(now, wd, true), hour, minute);
        if (first <= now) first = first.plus({ weeks: 1 });
      }
      return { iso: fmt(first), rrule, assumption };
    }
  }

  // --- fixed phrases ---
  const phrase = (dt: DateTime, assumption?: string): ResolvedTime => ({ iso: fmt(dt), assumption });

  if (/\b(end of (the )?day|eod)\b/.test(t)) return phrase(withTime(now, 17));
  if (/\btonight\b/.test(t)) return phrase(withTime(now, 21));
  if (/\bthis evening\b/.test(t)) return phrase(withTime(now, 19));
  if (/\bthis afternoon\b/.test(t)) return phrase(withTime(now, 15));
  if (/\bin the morning\b/.test(t)) {
    const nine = withTime(now, 9);
    const dt = nine > now ? nine : withTime(now.plus({ days: 1 }), 9);
    return phrase(dt, dt.day === now.day ? undefined : `assumed tomorrow at 9 AM`);
  }
  if (/\bthis weekend\b/.test(t)) {
    const sat = upcomingWeekday(now, 6, true);
    const dt = withTime(sat, 10);
    return phrase(dt.toMillis() > now.toMillis() ? dt : withTime(now, now.hour), `assumed ${fmtHuman(dt > now ? dt : now)}`);
  }
  if (/\bbeginning of next month\b/.test(t)) {
    const dt = withTime(now.plus({ months: 1 }).startOf('month'), 9);
    return phrase(dt, `assumed ${fmtHuman(dt)}`);
  }
  if (/\bin a bit\b|\blater\b/.test(t)) {
    const raw = now.plus({ hours: 3 });
    const rounded = raw.minute === 0 ? raw.startOf('hour') : raw.minute <= 30 ? raw.set({ minute: 30, second: 0, millisecond: 0 }) : raw.plus({ hours: 1 }).startOf('hour');
    return phrase(rounded, `assumed ${fmtHuman(rounded)}`);
  }
  if (/\bnoon\b/.test(t)) return phrase(withTime(now.hour >= 12 ? now.plus({ days: 1 }) : now, 12), now.hour >= 12 ? 'assumed tomorrow at noon' : undefined);

  // --- this/next/bare weekday (values normative: bare & "this" = upcoming; "next" = upcoming + 7d) ---
  {
    const m = t.match(/\b(this|next)? ?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?: at (\d{1,2})(:(\d{2}))?( ?(am|pm))?)?/);
    if (m) {
      const wd = WEEKDAYS[m[2] as string] as number;
      let day = upcomingWeekday(now, wd, false);
      let assumption: string | undefined;
      if (m[1] === 'next') {
        day = day.plus({ weeks: 1 });
        assumption = `assumed ${fmtDate(day.toMillis(), 'weekday-date', { tz: day.zoneName ?? undefined })} (the ${m[2]} after this coming one)`;
      }
      let dt = withTime(day, 9);
      let timeGiven = false;
      if (m[3]) {
        timeGiven = true;
        const hourRaw = parseInt(m[3], 10);
        const minute = m[5] ? parseInt(m[5], 10) : 0;
        const mer = m[7];
        if (mer === 'pm' && hourRaw < 12) dt = withTime(day, hourRaw + 12, minute);
        else if (mer === 'am') dt = withTime(day, hourRaw === 12 ? 0 : hourRaw, minute);
        else {
          const d = disambiguateBareHour(hourRaw, minute, day, now, true);
          dt = d.dt;
          assumption = assumption ? `${assumption}; ${d.assumption}` : d.assumption || undefined;
        }
      }
      if (!timeGiven) dt = withTime(day, 9);
      return { iso: fmt(dt), assumption };
    }
  }

  // --- relative deltas: "in 30 minutes", "in an hour" ---
  {
    const m = t.match(/\bin (\d+|an?) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/);
    if (m) {
      const n = m[1] === 'a' || m[1] === 'an' ? 1 : parseInt(m[1] as string, 10);
      const unit = (m[2] as string).startsWith('h') ? 'hours' : (m[2] as string).startsWith('s') ? 'seconds' : 'minutes';
      return { iso: fmt(now.plus({ [unit]: n })) };
    }
  }

  // --- chrono fallback (explicit dates/times, bare hours) ---
  const results = chrono.parse(text, { instant: opts.now, timezone: tz }, { forwardDate: true });
  const r = results[0];
  if (!r) return null;

  const known = (k: string): boolean => r.start.isCertain(k as never);
  const comp = r.start;
  const dayExplicit = known('day') || known('weekday') || known('month');

  // With an implied day chrono's forwardDate pre-rolls the date; anchor to today
  // instead so the C11 bare-hour rules decide, then roll forward ourselves.
  const day = dayExplicit
    ? DateTime.fromObject(
        { year: comp.get('year') ?? now.year, month: comp.get('month') ?? now.month, day: comp.get('day') ?? now.day },
        { zone: tz },
      )
    : now;
  const explicitFutureDay = dayExplicit && day.startOf('day') > now.startOf('day');

  let dt: DateTime;
  let assumption: string | undefined;

  const hour = comp.get('hour');
  if (hour === null || hour === undefined) {
    dt = withTime(day, 9);
    assumption = dayExplicit ? `assumed 9 AM` : undefined;
  } else if (hour > 12 || known('meridiem')) {
    dt = withTime(day, hour, comp.get('minute') ?? 0); // explicit meridiem or 24h form
  } else {
    const d = disambiguateBareHour(hour, comp.get('minute') ?? 0, day, now, explicitFutureDay);
    dt = d.dt;
    assumption = d.assumption || undefined;
  }

  // Roll forward: resolved time already past with no explicit date → next valid occurrence, declare.
  if (dt <= now && !dayExplicit) {
    dt = dt.plus({ days: 1 });
    assumption = `assumed ${fmtHuman(dt)}`;
  }

  return { iso: fmt(dt), assumption };
}
