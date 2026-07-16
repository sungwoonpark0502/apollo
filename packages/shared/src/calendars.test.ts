import { describe, expect, it } from 'vitest';
import {
  calendarColor,
  calendarById,
  CALENDAR_PALETTE,
  configureCalendars,
  DEFAULT_CALENDAR_COLOR,
  nearestPaletteColor,
  type CalendarCollection,
} from './index';

const list: CalendarCollection[] = [
  { id: 'default', name: 'Personal', color: '#D97757', kind: 'local', readOnly: false },
  { id: 'work', name: 'Work', color: '#4C8BF5', kind: 'local', readOnly: false },
];

describe('calendar color derivation', () => {
  it('resolves the color for a known id from an explicit list', () => {
    expect(calendarColor('work', list)).toBe('#4C8BF5');
    expect(calendarColor('default', list)).toBe('#D97757');
  });

  it('falls back to the default color for an unknown id', () => {
    expect(calendarColor('ghost', list)).toBe(DEFAULT_CALENDAR_COLOR);
  });

  it('reads from the configured process-global snapshot when no list is passed', () => {
    configureCalendars(list);
    expect(calendarColor('work')).toBe('#4C8BF5');
    expect(calendarById('work')?.name).toBe('Work');
    // restore a benign default so test order can't leak
    configureCalendars([{ id: 'default', name: 'Personal', color: DEFAULT_CALENDAR_COLOR, kind: 'local', readOnly: false }]);
    expect(calendarColor('work')).toBe(DEFAULT_CALENDAR_COLOR);
  });

  it('maps arbitrary hex to the nearest palette color', () => {
    expect(CALENDAR_PALETTE).toContain(nearestPaletteColor('#4d8cf6')); // close to blue
    expect(nearestPaletteColor('#000001')).toBe(nearestPaletteColor('#010101')); // both nearest gray-ish
    expect(nearestPaletteColor('not-a-color')).toBe(DEFAULT_CALENDAR_COLOR);
  });
});
