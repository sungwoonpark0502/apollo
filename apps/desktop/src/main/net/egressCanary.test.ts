import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BASE_ALLOWED_HOSTS, createEgressPolicy } from './egress';
import { createHttpClient } from './httpClient';
import { createBreaker } from './breaker';

/**
 * H4 egress canary: every outbound request the http client makes must target a
 * host in the C14.9 allowlist. We spy on the injected transport, drive a set of
 * representative requests, and assert the observed host set ⊆ allowlist.
 */
describe('egress canary (H4)', () => {
  it('the http client only ever calls allowlisted hosts, and blocks others before fetch', async () => {
    const observed = new Set<string>();
    const fetchSpy = vi.fn(async (url: string) => {
      observed.add(new URL(url).hostname);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const egress = createEgressPolicy(() => []); // no user feeds
    const http = createHttpClient({ egress, breaker: createBreaker(), fetchFn: fetchSpy as unknown as typeof fetch });

    // representative allowlisted calls (weather, geocoding, brave, anthropic)
    await http.getJson('https://api.open-meteo.com/v1/forecast?x=1');
    await http.getJson('https://geocoding-api.open-meteo.com/v1/search?name=x');
    await http.getJson('https://api.search.brave.com/res/v1/web/search?q=x');
    await http.postJson('https://api.anthropic.com/v1/messages', {});

    // a non-allowlisted host is rejected before any fetch happens
    await expect(http.getJson('https://evil.example.com/steal')).rejects.toThrow();

    const allow = new Set(BASE_ALLOWED_HOSTS);
    for (const host of observed) expect(allow.has(host)).toBe(true);
    expect(observed.has('evil.example.com')).toBe(false);
  });

  it('the base allowlist is a fixed set with no wildcard/arbitrary host (I4 does not widen it)', () => {
    for (const h of BASE_ALLOWED_HOSTS) {
      expect(h).not.toContain('*');
      expect(h).toMatch(/^[a-z0-9.-]+$/);
    }
    // The user-link lane adds no hosts to the standard allowlist.
    expect(createEgressPolicy(() => []).isAllowedUrl('https://arbitrary.example.com/x')).toBe(false);
  });

  it('the user-link lane (linkReader) is constructed only in main wiring and consumed only by the link tool', () => {
    const SRC = join(__dirname, '..'); // apps/desktop/src/main
    const constructs: string[] = []; // files that call createLinkReader(
    const importers: string[] = []; // files that reference the linkReader module
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts') || name === 'linkReader.ts') continue;
        const text = readFileSync(p, 'utf8');
        const rel = p.slice(SRC.length + 1).split(sep).join('/'); // POSIX-style so the assertion is platform-agnostic
        if (/createLinkReader\s*\(/.test(text)) constructs.push(rel);
        if (/from '.*\/net\/linkReader'/.test(text)) importers.push(rel);
      }
    };
    walk(SRC);
    // Only main wiring builds the lane; only the link tool references its type.
    expect(constructs.sort()).toEqual(['index.ts']);
    expect(importers.sort()).toEqual(['index.ts', 'tools/link.ts']);
  });
});
