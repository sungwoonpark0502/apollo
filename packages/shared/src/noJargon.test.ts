import { describe, expect, it } from 'vitest';
import { STRINGS } from './strings';

/**
 * Apollo is a product, not a wrapper around somebody's API. Nothing a user can
 * read should name a vendor, mention an API or a key, or otherwise expose the
 * plumbing — a person cannot act on "your Anthropic key", and being told to
 * check a settings screen that is hidden is worse than being told nothing.
 *
 * The credentials screen (settings.keys) is exempt: it exists precisely to
 * paste a provider key, is hidden unless APOLLO_SHOW_KEYS is set, and has to
 * name the provider to be usable at all. About's dependency list is exempt too,
 * since open-source attribution is a legal courtesy, not product copy.
 */
const EXEMPT_ROOTS = new Set(['keys']);

function collect(node: unknown, path: string[], out: Array<{ path: string; text: string }>): void {
  if (typeof node === 'string') {
    out.push({ path: path.join('.'), text: node });
    return;
  }
  if (typeof node === 'function') {
    // Render with placeholder args so template copy is checked too.
    try {
      const rendered = (node as (...a: unknown[]) => unknown)('x', 'y', 'z');
      if (typeof rendered === 'string') out.push({ path: path.join('.'), text: rendered });
    } catch {
      /* strings needing richer args are covered by their own suites */
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (path.length === 1 && EXEMPT_ROOTS.has(k)) continue;
      if (path.length === 0 && k === 'settings') {
        // descend, but let the keys exemption apply one level down
        collect(v, [...path, k], out);
        continue;
      }
      collect(v, [...path, k], out);
    }
  }
}

const ALL = ((): Array<{ path: string; text: string }> => {
  const out: Array<{ path: string; text: string }> = [];
  collect(STRINGS, [], out);
  return out;
})();

describe('no plumbing in user-facing copy', () => {
  it('collects a meaningful number of strings (guard is actually running)', () => {
    expect(ALL.length).toBeGreaterThan(300);
  });

  it('names no LLM/STT/search vendor', () => {
    const vendors = /\b(anthropic|claude|deepgram|picovoice|porcupine|brave search|openai|gpt-|gemini)\b/i;
    const offenders = ALL.filter((s) => vendors.test(s.text) && !s.path.startsWith('settings.keys') && !s.path.startsWith('about'));
    expect(offenders).toEqual([]);
  });

  it('never says "API"', () => {
    const offenders = ALL.filter((s) => /\bAPI\b/.test(s.text) && !s.path.startsWith('settings.keys'));
    expect(offenders).toEqual([]);
  });

  it('never tells a user about a key', () => {
    // "hotkey"/"keyboard"/"keyword" are legitimate; a bare "key" is not.
    const keyish = /\b(api key|provider key|access key|secret key|your .{0,20}key\b|add a .{0,20}key\b)/i;
    const offenders = ALL.filter((s) => keyish.test(s.text) && !s.path.startsWith('settings.keys'));
    expect(offenders).toEqual([]);
  });

  it('never points at the hidden credentials screen', () => {
    const offenders = ALL.filter((s) => /Settings\s*[>→]\s*Keys/i.test(s.text) && !s.path.startsWith('settings.keys'));
    expect(offenders).toEqual([]);
  });

  it('still names Google where the user really did connect an account', () => {
    // The opposite failure: scrubbing so hard that actionable copy disappears.
    // Gmail/Calendar are user-connected, so naming them is correct and useful.
    const mentionsGoogle = ALL.some((s) => /google/i.test(s.text));
    expect(mentionsGoogle).toBe(true);
  });
});
