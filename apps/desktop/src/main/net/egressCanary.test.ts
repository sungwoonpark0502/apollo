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
});
