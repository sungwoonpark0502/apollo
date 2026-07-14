import { DateTime } from 'luxon';
import { STRINGS } from '@apollo/shared';
import { type CandidateSuggestion, type ProactiveRule, ruleParam } from '../types';

/**
 * meeting_lead (time-sensitive): a non-all-day occurrence starts within leadMin
 * minutes. Fires exactly once per occurrence (dedupeKey = eventId+occStartTs),
 * never after start (expiresAt = occStart). Body: title, time, location.
 */
export const meetingLead: ProactiveRule = {
  id: 'meeting_lead',
  name: STRINGS.nudges.ruleNames['meeting_lead'] ?? 'meeting reminders',
  description: STRINGS.nudges.ruleDescriptions['meeting_lead'] ?? '',
  defaultEnabled: true,
  defaultParams: { leadMin: 10 },
  triggers: ['tick', 'data:event'],

  async evaluate(ctx) {
    const leadMin = Number(ruleParam(this, ctx.settings, 'leadMin')) || 10;
    const windowEnd = ctx.now + leadMin * 60_000;
    const out: CandidateSuggestion[] = [];
    // Query a minute past the lead boundary: expandOccurrences is half-open [start, end),
    // so an event starting exactly at windowEnd would otherwise be missed.
    for (const occ of ctx.repos.events.expandOccurrences(ctx.now, windowEnd + 60_000)) {
      if (occ.allDay) continue;
      if (occ.occStartTs <= ctx.now || occ.occStartTs > windowEnd) continue; // strictly upcoming, within lead
      const mins = Math.max(1, Math.round((occ.occStartTs - ctx.now) / 60_000));
      const time = DateTime.fromMillis(occ.occStartTs, { zone: occ.tz }).toFormat('h:mm a');
      out.push({
        ruleId: this.id,
        urgency: 'time-sensitive',
        title: STRINGS.nudges.meetingLeadTitle(occ.title, mins),
        body: STRINGS.nudges.meetingLeadBody(time, occ.location),
        actions: [
          { id: 'snooze', label: STRINGS.nudges.snooze5, kind: 'snooze' },
          { id: 'dismiss', label: STRINGS.nudges.dismiss, kind: 'dismiss' },
        ],
        dedupeKey: `${occ.eventId}+${occ.occStartTs}`,
        expiresAt: occ.occStartTs,
      });
    }
    return out;
  },
};
