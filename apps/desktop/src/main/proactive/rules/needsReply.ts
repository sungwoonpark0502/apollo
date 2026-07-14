import { DateTime } from 'luxon';
import { STRINGS } from '@apollo/shared';
import { type CandidateSuggestion, type ProactiveRule, ruleParam } from '../types';

/**
 * needs_reply (normal): at atHH, inbound threads addressed to the user, unreplied,
 * older than staleHours → one digest nudge (max 3). Read-only over the email
 * plumbing; sender/subject stay inert text (never fed to the LLM). Skips
 * silently when Gmail is not connected. dedupeKey = today's dateIso.
 */
export const needsReply: ProactiveRule = {
  id: 'needs_reply',
  name: STRINGS.nudges.ruleNames['needs_reply'] ?? 'reply reminders',
  description: STRINGS.nudges.ruleDescriptions['needs_reply'] ?? '',
  defaultEnabled: true,
  defaultParams: { atHH: 13, staleHours: 48 },
  triggers: ['tick'],

  async evaluate(ctx): Promise<CandidateSuggestion[]> {
    if (!ctx.gmailConnected || !ctx.emailNeedingReply) return []; // skip silently
    const atHH = Number(ruleParam(this, ctx.settings, 'atHH')) || 13;
    const staleHours = Number(ruleParam(this, ctx.settings, 'staleHours')) || 48;
    const nowLocal = DateTime.fromMillis(ctx.now, { zone: ctx.tz });
    if (nowLocal.hour < atHH) return [];

    const threads = await ctx.emailNeedingReply(staleHours);
    if (threads.length === 0) return [];

    const top = threads.slice(0, 3);
    // Inert text only — sender + subject rendered as plain text, never an LLM input.
    const lines = top.map((t) => `${t.from}: ${t.subject}`);
    const dateIso = nowLocal.toISODate() ?? '';
    return [
      {
        ruleId: this.id,
        urgency: 'normal',
        title: STRINGS.nudges.needsReplyTitle(threads.length),
        body: STRINGS.nudges.needsReplyBody(lines),
        card: { kind: 'text', body: lines.join('\n') },
        actions: [
          { id: 'open', label: STRINGS.nudges.openInbox, kind: 'primary' },
          { id: 'dismiss', label: STRINGS.nudges.dismiss, kind: 'dismiss' },
        ],
        dedupeKey: dateIso,
        expiresAt: nowLocal.endOf('day').toMillis(),
      },
    ];
  },
};
