import { describe, expect, it } from 'vitest';
import { buildRRule, detectPreset, isValidRRule } from './recurrence';

// Monday 2026-07-13 09:30 local
const MON = '2026-07-13T09:30:00';
// Wednesday 2026-07-15
const WED = '2026-07-15T14:00:00';

describe('buildRRule (E3.2 presets)', () => {
  it('none → null; daily/weekdays are fixed', () => {
    expect(buildRRule('none', MON)).toBeNull();
    expect(buildRRule('daily', MON)).toBe('FREQ=DAILY');
    expect(buildRRule('weekdays', MON)).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });
  it('weekly uses the start weekday', () => {
    expect(buildRRule('weekly', MON)).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(buildRRule('weekly', WED)).toBe('FREQ=WEEKLY;BYDAY=WE');
  });
  it('monthly uses the start day-of-month', () => {
    expect(buildRRule('monthly', MON)).toBe('FREQ=MONTHLY;BYMONTHDAY=13');
    expect(buildRRule('monthly', WED)).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });
  it('custom passes through and strips an RRULE: prefix', () => {
    expect(buildRRule('custom', MON, 'RRULE:FREQ=YEARLY')).toBe('FREQ=YEARLY');
    expect(buildRRule('custom', MON, '   ')).toBeNull();
  });
});

describe('detectPreset (round-trips buildRRule)', () => {
  for (const preset of ['none', 'daily', 'weekly', 'weekdays', 'monthly'] as const) {
    it(`${preset} round-trips`, () => {
      const rule = buildRRule(preset, MON);
      expect(detectPreset(rule, MON)).toBe(preset);
    });
  }
  it('an exotic rule is reported as custom', () => {
    expect(detectPreset('FREQ=YEARLY;BYMONTH=12', MON)).toBe('custom');
  });
  it('weekly detection is start-weekday aware', () => {
    expect(detectPreset('FREQ=WEEKLY;BYDAY=MO', MON)).toBe('weekly');
    expect(detectPreset('FREQ=WEEKLY;BYDAY=MO', WED)).toBe('custom'); // MO but start is WE
  });
});

describe('isValidRRule (E3.2 live validation)', () => {
  it('accepts well-formed rules', () => {
    expect(isValidRRule('FREQ=DAILY')).toBe(true);
    expect(isValidRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe(true);
    expect(isValidRRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=1')).toBe(true);
  });
  it('rejects garbage and empties', () => {
    expect(isValidRRule('')).toBe(false);
    expect(isValidRRule('every tuesday')).toBe(false);
    expect(isValidRRule('FREQ=NOPE')).toBe(false);
  });
});
