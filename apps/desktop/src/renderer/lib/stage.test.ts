import { describe, expect, it } from 'vitest';
import { isStageCard, sentenceToRow, stageDeepLink, stageRowCount, stageTitle } from './stage';
import type { CardPayload } from '@apollo/shared';

const news: CardPayload = { kind: 'newsList', items: [
  { title: 'A', source: 's', url: 'https://x/a', summary: '' },
  { title: 'B', source: 's', url: 'https://x/b', summary: '' },
  { title: 'C', source: 's', url: 'https://x/c', summary: '' },
] };
const weather: CardPayload = { kind: 'weather', place: 'Columbus', now: { tempF: 80, feelsF: 82, condition: 'Sunny', precipPct: 0, windMph: 5 }, days: [] };
const brief: CardPayload = { kind: 'brief', sections: [{ kind: 'text', body: 'one' }, { kind: 'text', body: 'two' }] };
const eventList: CardPayload = { kind: 'eventList', title: 'Today', events: [
  { id: 'e1', title: 'Standup', startTs: Date.parse('2026-07-14T09:00:00Z'), endTs: null, tz: 'UTC', allDay: false, rrule: null, location: null, notes: null },
] };
const textCard: CardPayload = { kind: 'text', body: 'hi' };

describe('isStageCard (E4 trigger)', () => {
  it('only voice-source brief/newsList/weather/eventList qualify', () => {
    expect(isStageCard(news, 'voice')).toBe(true);
    expect(isStageCard(weather, 'voice')).toBe(true);
    expect(isStageCard(brief, 'voice')).toBe(true);
    expect(isStageCard(eventList, 'voice')).toBe(true);
    expect(isStageCard(textCard, 'voice')).toBe(false);
    expect(isStageCard(news, 'text')).toBe(false); // text source never stages
  });
});

describe('stageRowCount', () => {
  it('counts news items / brief sections / events', () => {
    expect(stageRowCount(news)).toBe(3);
    expect(stageRowCount(brief)).toBe(2);
    expect(stageRowCount(eventList)).toBe(1);
    expect(stageRowCount(weather)).toBe(0);
  });
});

describe('sentenceToRow (best-effort, never throws)', () => {
  it('lead-in + one-per-row: sentence 0 highlights nothing, 1→row0', () => {
    expect(sentenceToRow(0, 3, 4)).toBeNull();
    expect(sentenceToRow(1, 3, 4)).toBe(0);
    expect(sentenceToRow(3, 3, 4)).toBe(2);
    expect(sentenceToRow(4, 3, 4)).toBeNull();
  });
  it('exact one-per-row mapping', () => {
    expect(sentenceToRow(0, 3, 3)).toBe(0);
    expect(sentenceToRow(2, 3, 3)).toBe(2);
    expect(sentenceToRow(3, 3, 3)).toBeNull();
  });
  it('no rows or bad input → null (no highlight)', () => {
    expect(sentenceToRow(0, 0, 5)).toBeNull();
    expect(sentenceToRow(-1, 3, 3)).toBeNull();
    expect(sentenceToRow(0, 3, 0)).toBeNull();
  });
  it('proportional fallback stays in range', () => {
    const r = sentenceToRow(5, 3, 10);
    expect(r === null || (r >= 0 && r < 3)).toBe(true);
  });
});

describe('stageTitle + stageDeepLink', () => {
  const s = { morningBrief: 'Morning brief', weatherIn: (p: string) => `Today's weather in ${p}`, news: 'Latest news', schedule: 'Your schedule' };
  it('titles per kind', () => {
    expect(stageTitle(brief, s)).toBe('Morning brief');
    expect(stageTitle(weather, s)).toBe("Today's weather in Columbus");
    expect(stageTitle(news, s)).toBe('Latest news');
    expect(stageTitle(eventList, s)).toBe('Your schedule');
  });
  it('deep links: brief/weather→today, eventList→calendar at first event date, news→null', () => {
    expect(stageDeepLink(brief)).toEqual({ view: 'today' });
    expect(stageDeepLink(weather)).toEqual({ view: 'today' });
    expect(stageDeepLink(eventList)).toEqual({ view: 'calendar', dateIso: '2026-07-14' });
    expect(stageDeepLink(news)).toBeNull();
  });
});
