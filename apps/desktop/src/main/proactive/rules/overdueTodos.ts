import { DateTime } from 'luxon';
import { STRINGS } from '@apollo/shared';
import { type ProactiveRule, ruleParam } from '../types';

const DAY_MS = 86_400_000;

/**
 * overdue_todos (low): at atHH, if todos overdue more than 24h exist, one
 * grouped nudge listing up to 5. dedupeKey = today's dateIso (once per day).
 */
export const overdueTodos: ProactiveRule = {
  id: 'overdue_todos',
  name: STRINGS.nudges.ruleNames['overdue_todos'] ?? 'overdue to-do nudges',
  description: STRINGS.nudges.ruleDescriptions['overdue_todos'] ?? '',
  defaultEnabled: true,
  defaultParams: { atHH: 16 },
  triggers: ['tick', 'data:todo'],

  async evaluate(ctx) {
    const atHH = Number(ruleParam(this, ctx.settings, 'atHH')) || 16;
    const nowLocal = DateTime.fromMillis(ctx.now, { zone: ctx.tz });
    if (nowLocal.hour < atHH) return [];

    const cutoff = ctx.now - DAY_MS;
    const overdue = ctx.repos.todos
      .listAll()
      .filter((t) => !t.done && t.dueTs !== null && t.dueTs < cutoff);
    if (overdue.length === 0) return [];

    const items = overdue.slice(0, 5).map((t) => t.content);
    const dateIso = nowLocal.toISODate() ?? '';
    return [
      {
        ruleId: this.id,
        urgency: 'low',
        title: STRINGS.nudges.overdueTodosTitle(overdue.length),
        body: STRINGS.nudges.overdueTodosBody(items),
        card: { kind: 'text', body: items.join('\n') },
        actions: [
          { id: 'open', label: STRINGS.nudges.openToday, kind: 'primary' },
          { id: 'dismiss', label: STRINGS.nudges.dismiss, kind: 'dismiss' },
        ],
        dedupeKey: dateIso,
        expiresAt: nowLocal.endOf('day').toMillis(),
      },
    ];
  },
};
