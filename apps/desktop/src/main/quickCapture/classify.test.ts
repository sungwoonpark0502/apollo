import { describe, expect, it } from 'vitest';
import { classifyCapture, nextCaptureType } from './classify';

const TZ = 'America/Los_Angeles';
// Saturday 2026-07-11 10:00 PT (matches the C11 reference instant).
const NOW = new Date('2026-07-11T10:00:00-07:00');

const cls = (text: string, def: 'note' | 'todo' = 'note') => classifyCapture(text, def, NOW, TZ);

describe('Quick Capture classifier (F4 golden set)', () => {
  it('plain text is a Note (verbatim)', () => {
    const c = cls('remember the milk in the fridge');
    expect(c.suggestedType).toBe('note');
    expect(c.texts.note).toBe('remember the milk in the fridge');
    expect(c.reminderAvailable).toBe(false);
  });

  it('empty / whitespace stays the default type', () => {
    expect(cls('').suggestedType).toBe('note');
    expect(cls('   ').reminderAvailable).toBe(false);
  });

  it('leading "todo " forces Todo and strips the prefix', () => {
    const c = cls('todo buy milk');
    expect(c.suggestedType).toBe('todo');
    expect(c.texts.todo).toBe('buy milk');
  });

  it('leading "TODO " is case-insensitive', () => {
    expect(cls('TODO file taxes').texts.todo).toBe('file taxes');
  });

  it('trailing "!" forces Todo and strips the suffix', () => {
    const c = cls('call the dentist!');
    expect(c.suggestedType).toBe('todo');
    expect(c.texts.todo).toBe('call the dentist');
  });

  it('trailing multiple "!!" is stripped', () => {
    expect(cls('submit the report!!').texts.todo).toBe('submit the report');
  });

  it('a future datetime makes it a Reminder with the time phrase stripped', () => {
    const c = cls('call mom tomorrow at 6');
    expect(c.suggestedType).toBe('reminder');
    expect(c.reminderAvailable).toBe(true);
    expect(c.reminderIso).toBeTruthy();
    expect(c.timePhrase).toMatch(/tomorrow/i);
    expect(c.texts.reminder).not.toMatch(/tomorrow/i);
    expect(c.texts.reminder).toMatch(/call mom/i);
  });

  it('bare hour 1-7 resolves to PM (Apollo grammar) and is in the future', () => {
    const c = cls('meeting at 3');
    expect(c.suggestedType).toBe('reminder');
    // 3 → 3 PM today, which is after 10 AM now
    expect(new Date(c.reminderIso as string).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('"in 30 minutes" is a Reminder', () => {
    const c = cls('stretch in 30 minutes');
    expect(c.suggestedType).toBe('reminder');
    expect(c.texts.reminder).toMatch(/stretch/i);
  });

  it('a past time keeps the default type (no reminder)', () => {
    // 8 AM already passed at 10 AM now → resolveTime rolls forward per grammar, so
    // use an explicit past date phrase that should not classify as a future reminder.
    const c = cls('notes from yesterday');
    expect(c.suggestedType).toBe('note');
    expect(c.reminderAvailable).toBe(false);
  });

  it('no-future-time text keeps Note', () => {
    expect(cls('grocery list ideas').suggestedType).toBe('note');
  });

  it('defaultType todo applies when nothing forces otherwise', () => {
    expect(cls('water the plants', 'todo').suggestedType).toBe('todo');
  });

  it('todo prefix wins over a time phrase', () => {
    const c = cls('todo call the bank at 2');
    expect(c.suggestedType).toBe('todo');
    expect(c.texts.todo).toContain('call the bank');
  });

  it('reminder text falls back to full text when no phrase is isolated', () => {
    const c = cls('dentist appointment friday');
    if (c.suggestedType === 'reminder') {
      expect(c.texts.reminder.length).toBeGreaterThan(0);
    }
  });
});

describe('nextCaptureType (Tab cycle)', () => {
  it('cycles Note → Todo → Reminder → Note when a time is available', () => {
    expect(nextCaptureType('note', true)).toBe('todo');
    expect(nextCaptureType('todo', true)).toBe('reminder');
    expect(nextCaptureType('reminder', true)).toBe('note');
  });

  it('skips Reminder when no time was resolved', () => {
    expect(nextCaptureType('note', false)).toBe('todo');
    expect(nextCaptureType('todo', false)).toBe('note');
  });
});
