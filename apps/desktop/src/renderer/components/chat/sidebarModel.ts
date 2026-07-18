import { DateTime } from 'luxon';
import { STRINGS } from '@apollo/shared';

/** K2 sidebar logic (grouping + filter), pure for unit testing. */
export interface ConversationSummary {
  id: string;
  title: string;
  startedAt: number;
  lastTs: number;
  messageCount: number;
  pinned: boolean;
}

export interface SidebarGroup {
  label: string;
  conversations: ConversationSummary[];
}

/** Case-insensitive substring filter over titles. */
export function filterConversations(list: readonly ConversationSummary[], query: string): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((c) => c.title.toLowerCase().includes(q));
}

/**
 * Groups by local calendar-day recency of last activity: Today / Yesterday /
 * Previous 7 days / Older (K2). Pinned conversations float into a leading
 * "Pinned" group regardless of age. Empty groups are omitted.
 */
export function groupConversations(list: readonly ConversationSummary[], nowMs: number = Date.now()): SidebarGroup[] {
  const today = DateTime.fromMillis(nowMs).startOf('day');
  const dayAge = (ts: number): number => today.diff(DateTime.fromMillis(ts).startOf('day'), 'days').days;

  const pinned: ConversationSummary[] = [];
  const buckets: Record<'today' | 'yesterday' | 'week' | 'older', ConversationSummary[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const c of list) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const age = dayAge(c.lastTs);
    if (age <= 0) buckets.today.push(c);
    else if (age === 1) buckets.yesterday.push(c);
    else if (age <= 7) buckets.week.push(c);
    else buckets.older.push(c);
  }

  const s = STRINGS.workspace.chat;
  const groups: SidebarGroup[] = [];
  if (pinned.length) groups.push({ label: s.groupPinned, conversations: pinned });
  if (buckets.today.length) groups.push({ label: s.groupToday, conversations: buckets.today });
  if (buckets.yesterday.length) groups.push({ label: s.groupYesterday, conversations: buckets.yesterday });
  if (buckets.week.length) groups.push({ label: s.groupWeek, conversations: buckets.week });
  if (buckets.older.length) groups.push({ label: s.groupOlder, conversations: buckets.older });
  return groups;
}
