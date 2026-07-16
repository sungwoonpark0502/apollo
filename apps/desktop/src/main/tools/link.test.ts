import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@apollo/shared';
import { createLinkTools, userProvidedUrl } from './link';

const okReader = {
  read: async (url: string) => ({ ok: true, url, title: 'Title', siteName: 'example.com', text: 'Reduced page text.', contentType: 'text/html' }),
};

function ctx(overrides: Partial<ToolCtx> = {}): ToolCtx {
  return {
    now: () => new Date(0),
    tz: 'UTC',
    convId: 'c1',
    turnId: 't1',
    taint: false,
    userUtterances: ['read https://example.com/post please'],
    source: 'text',
    ...overrides,
  };
}

function tool() {
  const [linkRead] = createLinkTools({ reader: okReader as never, allowLinkReading: () => true });
  return linkRead!;
}

describe('I4 link.read gates', () => {
  it('substring gate: only fetches URLs present verbatim in a user utterance', async () => {
    const t = tool();
    const provided = await t.execute({ url: 'https://example.com/post' }, ctx());
    expect(provided.untrusted).toBe(true);
    expect(provided.card?.kind).toBe('linkPreview');

    const notProvided = await t.execute({ url: 'https://evil.com/exfil' }, ctx());
    expect(notProvided.llmText).toContain('ERROR');
    expect(notProvided.card).toBeUndefined();
  });

  it('userProvidedUrl matches with and without a trailing slash, case-insensitive', () => {
    expect(userProvidedUrl('https://Example.com/Post', ['see HTTPS://EXAMPLE.COM/POST now'])).toBe(true);
    expect(userProvidedUrl('https://example.com/post/', ['https://example.com/post'])).toBe(true);
    expect(userProvidedUrl('https://example.com/other', ['https://example.com/post'])).toBe(false);
  });

  it('enforces a per-turn cap of 2 fetches', async () => {
    const t = tool();
    const c = ctx({ userUtterances: ['a https://example.com/1 b https://example.com/2 c https://example.com/3'] });
    expect((await t.execute({ url: 'https://example.com/1' }, c)).untrusted).toBe(true);
    expect((await t.execute({ url: 'https://example.com/2' }, c)).untrusted).toBe(true);
    const third = await t.execute({ url: 'https://example.com/3' }, c);
    expect(third.llmText).toContain('two links per turn');
  });

  it('returns an error (not a fetch) when link reading is disabled by policy', async () => {
    const [linkRead] = createLinkTools({ reader: okReader as never, allowLinkReading: () => false });
    const r = await linkRead!.execute({ url: 'https://example.com/post' }, ctx());
    expect(r.llmText).toContain('turned off');
    expect(r.card).toBeUndefined();
  });

  it('is a tier-1 networked tool', () => {
    const t = tool();
    expect(t.tier).toBe(1);
    expect(t.networked).toBe(true);
  });
});
