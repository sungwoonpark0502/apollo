import { DateTime } from 'luxon';
import { STRINGS } from '@apollo/shared';
import { type CandidateSuggestion, type ProactiveRule } from '../types';

const PRECIP_THRESHOLD = 70; // %

/**
 * weather_heads_up (low): around 07:30 local, if precipitation probability >= 70%
 * within the next 12h AND today has an occurrence with a non-empty location,
 * one umbrella nudge. Skips when homePlace is unset. dedupeKey = today's dateIso.
 */
export const weatherHeadsUp: ProactiveRule = {
  id: 'weather_heads_up',
  name: STRINGS.nudges.ruleNames['weather_heads_up'] ?? 'weather heads-ups',
  description: STRINGS.nudges.ruleDescriptions['weather_heads_up'] ?? '',
  defaultEnabled: true,
  defaultParams: { atHH: 7, atMM: 30 },
  triggers: ['tick', 'data:event'],

  async evaluate(ctx): Promise<CandidateSuggestion[]> {
    if (!ctx.settings.profile.homePlace || !ctx.weatherPrecipNext12h) return []; // skip when home unset
    const nowLocal = DateTime.fromMillis(ctx.now, { zone: ctx.tz });
    // fire from 07:30 onward (until an occurrence-with-location has passed)
    if (nowLocal.hour < 7 || (nowLocal.hour === 7 && nowLocal.minute < 30)) return [];

    const dayStart = nowLocal.startOf('day').toMillis();
    const dayEnd = nowLocal.endOf('day').toMillis();
    const located = ctx.repos.events
      .expandOccurrences(ctx.now, dayEnd)
      .filter((o) => !o.allDay && o.location && o.location.trim().length > 0 && o.occStartTs >= dayStart);
    if (located.length === 0) return [];

    const precip = await ctx.weatherPrecipNext12h();
    if (precip === null || precip < PRECIP_THRESHOLD) return [];

    const event = located[0]!.title;
    const dateIso = nowLocal.toISODate() ?? '';
    return [
      {
        ruleId: this.id,
        urgency: 'low',
        title: STRINGS.nudges.weatherHeadsUpTitle,
        body: STRINGS.nudges.weatherHeadsUpBody(event),
        actions: [{ id: 'dismiss', label: STRINGS.nudges.dismiss, kind: 'dismiss' }],
        dedupeKey: dateIso,
        expiresAt: located[0]!.occStartTs,
      },
    ];
  },
};
