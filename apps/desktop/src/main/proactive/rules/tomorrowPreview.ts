import { DateTime } from 'luxon';
import { calendarColor, STRINGS, type EventDTO } from '@apollo/shared';
import { type ProactiveRule, ruleParam } from '../types';

/**
 * tomorrow_preview (normal): at atHH, if tomorrow has >=3 occurrences OR any
 * occurrence before 09:00, one summary nudge with an eventList card.
 * dedupeKey = tomorrow's dateIso. Fires from atHH onward, once per day.
 */
export const tomorrowPreview: ProactiveRule = {
  id: 'tomorrow_preview',
  name: STRINGS.nudges.ruleNames['tomorrow_preview'] ?? "tomorrow's preview",
  description: STRINGS.nudges.ruleDescriptions['tomorrow_preview'] ?? '',
  defaultEnabled: true,
  defaultParams: { atHH: 21 },
  triggers: ['tick'],

  async evaluate(ctx) {
    const atHH = Number(ruleParam(this, ctx.settings, 'atHH')) || 21;
    const nowLocal = DateTime.fromMillis(ctx.now, { zone: ctx.tz });
    if (nowLocal.hour < atHH) return []; // not yet the preview hour

    const tomorrow = nowLocal.plus({ days: 1 }).startOf('day');
    const occ = ctx.repos.events.expandOccurrences(tomorrow.toMillis(), tomorrow.endOf('day').toMillis());
    const timed = occ.filter((o) => !o.allDay);
    const earlyOnes = timed.filter((o) => DateTime.fromMillis(o.occStartTs, { zone: o.tz }).hour < 9);
    if (occ.length < 3 && earlyOnes.length === 0) return [];

    const events: EventDTO[] = occ.slice(0, 5).map((o) => ({
      id: o.eventId, title: o.title, startTs: o.occStartTs, endTs: o.occEndTs, tz: o.tz,
      allDay: o.allDay, rrule: o.rrule, location: o.location, notes: o.notes,
      calendarId: o.calendarId, color: calendarColor(o.calendarId),
    }));
    const dateIso = tomorrow.toISODate() ?? '';
    return [
      {
        ruleId: this.id,
        urgency: 'normal',
        title: STRINGS.nudges.tomorrowPreviewTitle(occ.length),
        body: STRINGS.nudges.tomorrowPreviewBody,
        card: { kind: 'eventList', title: STRINGS.nudges.tomorrowPreviewTitle(occ.length), events },
        actions: [
          { id: 'open', label: STRINGS.nudges.openCalendar, kind: 'primary' },
          { id: 'dismiss', label: STRINGS.nudges.dismiss, kind: 'dismiss' },
        ],
        dedupeKey: dateIso,
        expiresAt: tomorrow.endOf('day').toMillis(),
      },
    ];
  },
};
