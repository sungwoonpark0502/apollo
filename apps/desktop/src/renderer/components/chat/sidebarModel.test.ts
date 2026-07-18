import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { filterConversations, groupConversations, type ConversationSummary } from './sidebarModel';

const NOW = DateTime.fromISO('2026-07-18T14:00:00').toMillis();

const conv = (id: string, lastIso: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: `conv ${id}`,
  startedAt: DateTime.fromISO(lastIso).toMillis(),
  lastTs: DateTime.fromISO(lastIso).toMillis(),
  messageCount: 2,
  pinned: false,
  ...over,
});

describe('K5 sidebar grouping', () => {
  it('buckets by Today / Yesterday / Previous 7 days / Older on local calendar days', () => {
    const groups = groupConversations(
      [
        conv('a', '2026-07-18T09:00:00'), // today
        conv('b', '2026-07-17T23:50:00'), // yesterday (calendar day, not 24h)
        conv('c', '2026-07-12T08:00:00'), // within 7 days
        conv('d', '2026-06-01T08:00:00'), // older
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older']);
    expect(groups.map((g) => g.conversations.map((c) => c.id))).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('pinned conversations float into a leading Pinned group regardless of age', () => {
    const groups = groupConversations(
      [conv('old-pin', '2026-01-01T00:00:00', { pinned: true }), conv('a', '2026-07-18T09:00:00')],
      NOW,
    );
    expect(groups[0]).toMatchObject({ label: 'Pinned' });
    expect(groups[0]!.conversations[0]!.id).toBe('old-pin');
  });

  it('omits empty groups', () => {
    const groups = groupConversations([conv('a', '2026-07-18T09:00:00')], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today']);
  });
});

describe('K5 sidebar filter', () => {
  const list = [conv('a', '2026-07-18T09:00:00', { title: 'Trip planning' }), conv('b', '2026-07-18T10:00:00', { title: 'timer talk' })];
  it('is case-insensitive substring on the title', () => {
    expect(filterConversations(list, 'TRIP').map((c) => c.id)).toEqual(['a']);
    expect(filterConversations(list, 'tim').map((c) => c.id)).toEqual(['b']);
    expect(filterConversations(list, '')).toHaveLength(2);
    expect(filterConversations(list, 'zzz')).toHaveLength(0);
  });
});
