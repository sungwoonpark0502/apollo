/**
 * H4 usage warn-once logic. Returns whether to show the warning card and the
 * updated "last warned day" so the card appears at most once per local day.
 */
export function shouldWarnUsage(input: {
  todayTotalTokens: number;
  limit: number | null;
  today: string;
  lastWarnedDay: string | null;
}): { warn: boolean; lastWarnedDay: string | null } {
  if (input.limit === null || input.limit <= 0) return { warn: false, lastWarnedDay: input.lastWarnedDay };
  if (input.todayTotalTokens < input.limit) return { warn: false, lastWarnedDay: input.lastWarnedDay };
  if (input.lastWarnedDay === input.today) return { warn: false, lastWarnedDay: input.lastWarnedDay };
  return { warn: true, lastWarnedDay: input.today };
}
