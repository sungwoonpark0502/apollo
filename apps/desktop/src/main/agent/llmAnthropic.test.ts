import { describe, expect, it } from 'vitest';
import { sanitizeToolName } from './llmAnthropic';

// The registry's real tool names (namespace.verb). Anthropic rejects any name
// not matching this pattern — the dot is the offender.
const ANTHROPIC_TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
const REAL_NAMES = [
  'timer.start', 'alarm.set', 'note.save', 'calendar.create', 'calendar.list', 'link.read',
  'search.web', 'email.send', 'system.openApp', 'reminder.snooze', 'undo.last', 'weather.now',
];

describe('Anthropic tool-name sanitization (dots break the API pattern)', () => {
  it('every real tool name becomes a pattern-valid wire name', () => {
    for (const name of REAL_NAMES) {
      const wire = sanitizeToolName(name);
      expect(wire, `${name} -> ${wire}`).toMatch(ANTHROPIC_TOOL_NAME);
      expect(wire).not.toContain('.');
    }
  });

  it('is a bijection for the dotted, underscore-free naming convention', () => {
    // No real tool name contains an underscore, so sanitize is invertible via _→.
    const wireToReal = new Map<string, string>();
    for (const name of REAL_NAMES) wireToReal.set(sanitizeToolName(name), name);
    expect(wireToReal.size).toBe(REAL_NAMES.length); // no collisions
    for (const name of REAL_NAMES) expect(wireToReal.get(sanitizeToolName(name))).toBe(name);
  });

  it('leaves already-valid names untouched', () => {
    expect(sanitizeToolName('search_web')).toBe('search_web');
    expect(sanitizeToolName('link-read')).toBe('link-read');
  });
});
