import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx, ToolDef, ToolResult } from '@apollo/shared';
import { createBriefTool } from './brief';

function ctx(): ToolCtx {
  return {
    now: () => new Date('2026-07-12T08:30:00-07:00'),
    tz: 'America/Los_Angeles',
    convId: 'c1',
    turnId: 't1',
    taint: false,
    userUtterances: ['good morning'],
    source: 'voice',
  };
}

function stubTool(name: string, result: ToolResult): ToolDef {
  return {
    name,
    tier: 1,
    description: name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: { safeParse: () => ({ success: true, data: {} }) } as any,
    execute: vi.fn(async () => result),
  };
}

describe('brief.daily (C7 composite)', () => {
  it('composes a spoken paragraph and a brief card stack from sub-tools', async () => {
    const tools: Record<string, ToolDef> = {
      'calendar.list': stubTool('calendar.list', {
        llmText: 'You have 2 events today. Dentist at 9.',
        card: { kind: 'eventList', title: 'Today', events: [] },
      }),
      'weather.now': stubTool('weather.now', {
        llmText: 'It is 72 and sunny.',
        card: { kind: 'weather', place: 'Home', now: { tempF: 72, feelsF: 72, condition: 'Sunny', precipPct: 0, windMph: 3 }, days: [] },
      }),
      'news.brief': stubTool('news.brief', {
        llmText: 'Top headlines.',
        card: { kind: 'newsList', items: [{ title: 'Big story', source: 'AP', url: 'https://x', summary: 's' }] },
        untrusted: true,
      }),
    };
    const brief = createBriefTool({ getTool: (n) => tools[n], emailConnected: () => false });
    const res = await brief.execute({}, ctx());

    expect(res.card?.kind).toBe('brief');
    if (res.card?.kind !== 'brief') throw new Error('expected brief');
    expect(res.card.sections).toHaveLength(3); // calendar, weather, news
    expect(res.llmText).toContain('2 events');
    expect(res.llmText).toContain('Big story');
    expect(res.untrusted).toBe(true); // news is untrusted
  });

  it('degrades with a note when a section is unavailable, never throwing', async () => {
    const tools: Record<string, ToolDef> = {
      'calendar.list': stubTool('calendar.list', { llmText: 'Nothing on your calendar today.' }),
      'weather.now': {
        name: 'weather.now',
        tier: 1,
        description: 'w',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: { safeParse: () => ({ success: true, data: {} }) } as any,
        execute: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    };
    const brief = createBriefTool({ getTool: (n) => tools[n], emailConnected: () => false });
    const res = await brief.execute({}, ctx());
    expect(res.llmText).toContain('weather'); // named in the couldn't-reach note
    expect(res.card?.kind).toBe('brief');
  });

  it('includes an unread-email highlight when email is connected', async () => {
    const tools: Record<string, ToolDef> = {
      'email.list': stubTool('email.list', {
        llmText: '<data source="email">unread</data>',
        card: {
          kind: 'emailList',
          items: [{ id: 'm1', from: 'a@b.c', subject: 'Hi', snippet: 'x', ts: 1, unread: true }],
        },
        untrusted: true,
      }),
    };
    const brief = createBriefTool({ getTool: (n) => tools[n], emailConnected: () => true });
    const res = await brief.execute({}, ctx());
    expect(res.llmText).toContain('1 unread');
    expect(res.untrusted).toBe(true);
  });
});
