import { describe, expect, it } from 'vitest';
import { cardPayloadSchema, type CardPayload } from './cards';
import { agentEventSchema, type AgentEvent } from './agent';
import { SettingsSchema, defaultSettings } from './settings';

const event = {
  id: 'e1', title: 'Dentist', startTs: 1_800_000_000_000, endTs: 1_800_003_600_000,
  tz: 'America/Los_Angeles', allDay: false, rrule: null, location: null, notes: null,
};

const samples: CardPayload[] = [
  { kind: 'text', body: 'hello' },
  { kind: 'event', event },
  { kind: 'eventList', title: 'Today', events: [event] },
  {
    kind: 'weather',
    place: 'Columbus',
    now: { tempF: 88, feelsF: 92, condition: 'Sunny', precipPct: 5, windMph: 6 },
    days: [{ dateIso: '2026-07-12', hiF: 90, loF: 70, condition: 'Clear', precipPct: 0 }],
  },
  { kind: 'newsList', items: [{ title: 'Headline', source: 'AP', url: 'https://apnews.com/x', summary: 'Two sentences.' }] },
  { kind: 'timer', id: 't1', label: 'pasta', endsAt: 1_800_000_500_000 },
  { kind: 'emailList', items: [{ id: 'm1', from: 'a@b.c', subject: 'Hi', snippet: 'yo', ts: 1, unread: true }] },
  {
    kind: 'emailDetail',
    email: { id: 'm1', from: 'a@b.c', to: ['me@x.y'], subject: 'Hi', ts: 1, safeHtml: '<p>hi</p>', plainText: 'hi', remoteImagesBlocked: 2 },
  },
  { kind: 'draft', to: ['jane@x.com'], subject: 'Re: lease', body: 'Sounds good.' },
  {
    kind: 'confirm',
    confirmationId: 'cf1',
    action: { toolName: 'email.send', summary: 'Send email to jane@x.com: "Re: lease"', args: { to: ['jane@x.com'] }, taintFlags: [] },
    expiresAt: 1_800_000_000_000,
  },
  { kind: 'brief', sections: [{ kind: 'text', body: 'Good morning' }] },
  {
    kind: 'nudge',
    suggestion: {
      id: 's1', ruleId: 'meeting_lead', urgency: 'time-sensitive', title: 'Standup in 10 min',
      body: '9:30 AM (Room 2)', actions: [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }], createdAt: 1,
    },
  },
  {
    kind: 'nudgeGroup',
    suggestions: [
      {
        id: 's2', ruleId: 'overdue_todos', urgency: 'low', title: '2 overdue to-dos', body: '',
        card: { kind: 'text', body: 'buy milk; file taxes' },
        actions: [{ id: 'open', label: 'Open today', kind: 'primary' }, { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }],
        createdAt: 2,
      },
    ],
  },
];

describe('card payload round-trips (every kind)', () => {
  for (const card of samples) {
    it(card.kind, () => {
      expect(cardPayloadSchema.parse(card)).toEqual(card);
    });
  }
  it('covers every kind in the union', () => {
    const kinds = new Set(samples.map((s) => s.kind));
    expect([...kinds].sort()).toEqual(
      ['brief', 'confirm', 'draft', 'emailDetail', 'emailList', 'event', 'eventList', 'newsList', 'nudge', 'nudgeGroup', 'text', 'timer', 'weather'].sort(),
    );
  });
  it('rejects unknown kind', () => {
    expect(cardPayloadSchema.safeParse({ kind: 'gif', url: 'x' }).success).toBe(false);
  });
});

describe('agent events', () => {
  const events: AgentEvent[] = [
    { type: 'turnStart', turnId: 't' },
    { type: 'token', text: 'Sure' },
    { type: 'toolStart', tool: 'timer.start' },
    { type: 'toolResult', tool: 'timer.start', ok: true },
    { type: 'card', card: { kind: 'text', body: 'x' } },
    {
      type: 'confirmRequest',
      confirmationId: 'c',
      action: { toolName: 'email.send', summary: 's', args: {}, taintFlags: ['value_not_user_stated:recipient'] },
      expiresAt: 5,
    },
    { type: 'cancelWindow', confirmationId: 'c', ms: 5000 },
    { type: 'done', turnId: 't' },
    { type: 'error', code: 'OFFLINE', userMessage: 'offline' },
  ];
  for (const ev of events) {
    it(ev.type, () => expect(agentEventSchema.parse(ev)).toEqual(ev));
  }
  it('rejects bad error codes', () => {
    expect(agentEventSchema.safeParse({ type: 'error', code: 'EXPLODED', userMessage: 'x' }).success).toBe(false);
  });
});

describe('settings', () => {
  it('defaults parse and round-trip', () => {
    const s = defaultSettings();
    expect(SettingsSchema.parse(s)).toEqual(s);
    expect(s.hotkey).toBe('Alt+Space');
    expect(s.anthropic.model).toBe('claude-sonnet-4-6');
  });
  it('rejects out-of-range values', () => {
    expect(SettingsSchema.safeParse({ ...defaultSettings(), dnd: { startHH: 25, endHH: 8 } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), wake: { enabled: true, sensitivity: 2 } }).success).toBe(false);
  });
});
