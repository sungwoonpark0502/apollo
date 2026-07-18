import { describe, expect, it, vi } from 'vitest';
import { createLinkReader, reduceHtml, firstParagraph } from './linkReader';

const PUBLIC = async (): Promise<string[]> => ['93.184.216.34'];
const PRIVATE = async (): Promise<string[]> => ['10.0.0.5'];

function html(body: string, title = 'Example Title'): string {
  return `<!doctype html><html><head><title>${title}</title><meta property="og:site_name" content="Example Site"></head><body>${body}</body></html>`;
}

function res(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers } });
}

describe('I4 link reader (user-link lane)', () => {
  it('fetches HTML and reduces it to readable text with title + site name', async () => {
    const fetchFn = vi.fn(async () => res(html('<article><h1>Hi</h1><p>First sentence. Second sentence.</p><script>evil()</script></article>')));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PUBLIC });
    const r = await reader.read('https://example.com/post');
    expect(r.ok).toBe(true);
    expect(r.title).toBe('Example Title');
    expect(r.siteName).toBe('Example Site');
    expect(r.text).toContain('First sentence');
    expect(r.text).not.toContain('evil()'); // script stripped
  });

  it('blocks a host that resolves to a private address (SSRF)', async () => {
    const fetchFn = vi.fn(async () => res(html('<p>secret</p>')));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PRIVATE });
    const r = await reader.read('http://intranet.evil.com/');
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled(); // guarded before any network
  });

  it('J5: blocks DNS rebinding — public on the first lookup, private on the connect-time re-check', async () => {
    const fetchFn = vi.fn(async () => res(html('<p>secret</p>')));
    let call = 0;
    // Same host rebinds: first resolution public (initial guard), second private (connect-time).
    const rebinding = async (): Promise<string[]> => (++call === 1 ? ['93.184.216.34'] : ['169.254.169.254']);
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: rebinding });
    const r = await reader.read('https://rebind.evil.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/private|reserved/i);
    expect(fetchFn).not.toHaveBeenCalled(); // rejected before any connect
    expect(call).toBeGreaterThanOrEqual(2); // it re-resolved at connect time
  });

  it('re-checks the SSRF guard on each redirect hop', async () => {
    let call = 0;
    // hop 0: public host 302 → hop 1 target resolves private
    const fetchFn = vi.fn(async () => {
      call++;
      if (call === 1) return res('', { status: 302, headers: { location: 'http://metadata.evil.com/' } });
      return res(html('<p>should never reach here</p>'));
    });
    const resolver = async (host: string): Promise<string[]> => (host === 'metadata.evil.com' ? ['169.254.169.254'] : ['93.184.216.34']);
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver });
    const r = await reader.read('https://start.example.com/');
    expect(r.ok).toBe(false);
    expect(call).toBe(1); // stopped at the redirect, never fetched the private hop
  });

  it('caps redirects at 3', async () => {
    const fetchFn = vi.fn(async () => res('', { status: 302, headers: { location: 'https://example.com/next' } }));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PUBLIC });
    const r = await reader.read('https://example.com/start');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('redirect');
  });

  it('rejects an oversized declared response', async () => {
    const fetchFn = vi.fn(async () => res(html('<p>x</p>'), { headers: { 'content-length': String(3 * 1024 * 1024) } }));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PUBLIC });
    const r = await reader.read('https://example.com/big');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('large');
  });

  it('describes non-HTML content instead of returning bytes', async () => {
    const fetchFn = vi.fn(async () => new Response('%PDF-1.7 ...', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PUBLIC });
    const r = await reader.read('https://example.com/doc.pdf');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('PDF');
    expect(r.text).not.toContain('%PDF-1.7');
  });

  it('previewOnly returns just the first sentences', async () => {
    const fetchFn = vi.fn(async () => res(html('<p>One. Two. Three. Four. Five.</p>')));
    const reader = createLinkReader({ fetchFn: fetchFn as unknown as typeof fetch, resolver: PUBLIC });
    const r = await reader.read('https://example.com/post', { previewOnly: true });
    expect(r.text.startsWith('One. Two.')).toBe(true);
    expect(r.text).not.toContain('Five.');
  });
});

describe('readability helpers', () => {
  it('reduceHtml strips chrome and decodes entities', () => {
    const out = reduceHtml('<html><head><title>T &amp; U</title></head><body><nav>menu</nav><main><p>Body&nbsp;text</p></main><footer>foot</footer></body></html>', 'https://x.com');
    expect(out.title).toBe('T & U');
    expect(out.text).toContain('Body text');
    expect(out.text).not.toContain('menu');
    expect(out.text).not.toContain('foot');
  });
  it('firstParagraph caps to ~2 sentences', () => {
    expect(firstParagraph('Alpha. Beta. Gamma.')).toBe('Alpha. Beta.');
  });
});
