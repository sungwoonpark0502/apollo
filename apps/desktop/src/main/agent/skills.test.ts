import { describe, expect, it } from 'vitest';
import { defaultSettings, SettingsSchema } from '@apollo/shared';
import { applySkills, buildSystemPrompt } from './systemPrompt';

/** Skills v1: user-authored instruction packs appended to the system prompt. */
const BASE = buildSystemPrompt('Sam');

describe('skills prompt assembly', () => {
  it('no skills = the exact base prompt, byte for byte', () => {
    expect(applySkills(BASE, [])).toBe(BASE);
    expect(applySkills(BASE, [{ name: 'x', prompt: 'y', enabled: false }])).toBe(BASE);
  });

  it('appends only ENABLED skills, in order, under a labelled section', () => {
    const out = applySkills(BASE, [
      { name: 'Terse mode', prompt: 'Keep every reply under two sentences.', enabled: true },
      { name: 'Disabled one', prompt: 'NEVER APPEAR', enabled: false },
      { name: 'Korean', prompt: 'Reply in Korean when spoken to in Korean.', enabled: true },
    ]);
    expect(out.startsWith(BASE)).toBe(true); // core rules always come first
    expect(out).toContain('### Terse mode');
    expect(out).toContain('### Korean');
    expect(out).not.toContain('NEVER APPEAR');
    expect(out.indexOf('Terse mode')).toBeLessThan(out.indexOf('Korean'));
  });

  it('tells the model core rules outrank skills', () => {
    const out = applySkills(BASE, [{ name: 'a', prompt: 'b', enabled: true }]);
    expect(out).toContain('the rules above win');
  });
});

describe('skills settings schema', () => {
  it('defaults to none and caps count and size', () => {
    expect(defaultSettings().skills).toEqual([]);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: 'n', prompt: 'p', enabled: true }));
    expect(SettingsSchema.safeParse({ ...defaultSettings(), skills: many }).success).toBe(false);
    const huge = [{ id: 's', name: 'n', prompt: 'x'.repeat(2001), enabled: true }];
    expect(SettingsSchema.safeParse({ ...defaultSettings(), skills: huge }).success).toBe(false);
  });

  it('accepts a normal skill', () => {
    const ok = [{ id: 's1', name: 'Terse', prompt: 'Short replies.', enabled: true }];
    expect(SettingsSchema.safeParse({ ...defaultSettings(), skills: ok }).success).toBe(true);
  });
});
