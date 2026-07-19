import { describe, expect, it, vi } from 'vitest';
import { BASE_ALLOWED_HOSTS, createEgressPolicy } from './egress';
import { createBreaker } from './breaker';
import { createHttpClient } from './httpClient';
import { AppError } from '@apollo/shared';

describe('egress allowlist (C14.9)', () => {
  const egress = createEgressPolicy(() => ['feeds.example.com']);

  it('allows base hosts and user feed hosts over https only', () => {
    expect(egress.isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(true);
    expect(egress.isAllowedUrl('https://geocoding-api.open-meteo.com/v1/search?name=x')).toBe(true);
    expect(egress.isAllowedUrl('https://feeds.example.com/rss')).toBe(true);
    expect(egress.isAllowedUrl('http://api.anthropic.com/v1/messages')).toBe(false); // no plaintext
    expect(egress.isAllowedUrl('https://evil.com/x')).toBe(false);
    expect(egress.isAllowedUrl('https://api.anthropic.com.evil.com/x')).toBe(false); // suffix spoof
    expect(egress.isAllowedUrl('not a url')).toBe(false);
  });
});

describe('circuit breaker (C15)', () => {
  it('opens after 5 consecutive failures, half-opens after 30s, closes on probe success', () => {
    let now = 0;
    const b = createBreaker(() => now);
    for (let i = 0; i < 4; i++) b.recordFailure('h');
    expect(b.stateOf('h')).toBe('closed');
    b.recordFailure('h');
    expect(b.stateOf('h')).toBe('open');
    expect(b.canRequest('h')).toBe(false);

    now = 30_001;
    expect(b.canRequest('h')).toBe(true); // half-open probe
    expect(b.stateOf('h')).toBe('half-open');
    b.recordSuccess('h');
    expect(b.stateOf('h')).toBe('closed');
  });

  it('a failed half-open probe reopens immediately', () => {
    let now = 0;
    const b = createBreaker(() => now);
    for (let i = 0; i < 5; i++) b.recordFailure('h');
    now = 30_001;
    b.canRequest('h');
    b.recordFailure('h');
    expect(b.stateOf('h')).toBe('open');
    now = 30_002;
    expect(b.canRequest('h')).toBe(false);
  });

  it('success resets the consecutive counter', () => {
    const b = createBreaker(() => 0);
    for (let i = 0; i < 4; i++) b.recordFailure('h');
    b.recordSuccess('h');
    for (let i = 0; i < 4; i++) b.recordFailure('h');
    expect(b.stateOf('h')).toBe('closed');
  });
});

describe('httpClient (C15)', () => {
  const egress = createEgressPolicy(() => []);

  it('blocks non-allowlisted urls before any fetch', async () => {
    const fetchFn = vi.fn();
    const http = createHttpClient({ egress, breaker: createBreaker(), fetchFn: fetchFn as unknown as typeof fetch });
    await expect(http.getJson('https://evil.com/x')).rejects.toThrow(/egress blocked/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retries GET on 5xx with backoff then fails; breaker records failures', async () => {
    const breaker = createBreaker(() => 0);
    const fetchFn = vi.fn().mockResolvedValue(new Response('oops', { status: 503 }));
    const http = createHttpClient({ egress, breaker, fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined });
    await expect(http.getJson('https://api.open-meteo.com/v1/forecast')).rejects.toThrow(AppError);
    expect(fetchFn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('recovers when a retry succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const http = createHttpClient({ egress, breaker: createBreaker(), fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined });
    expect(await http.getJson('https://api.open-meteo.com/x')).toEqual({ ok: 1 });
  });

  it('does not retry POST and maps 401 to KEY_INVALID', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const http = createHttpClient({ egress, breaker: createBreaker(), fetchFn: fetchFn as unknown as typeof fetch });
    await expect(http.postJson('https://api.anthropic.com/v1/messages', {})).rejects.toMatchObject({ code: 'KEY_INVALID' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses requests while the circuit is open', async () => {
    const breaker = createBreaker(() => 0);
    for (let i = 0; i < 5; i++) breaker.recordFailure('api.deepgram.com');
    const fetchFn = vi.fn();
    const http = createHttpClient({ egress, breaker, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(http.getJson('https://api.deepgram.com/v1/listen')).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('L6 mode-aware egress allowlist', () => {
  const hosts = {
    backendBaseUrl: 'https://api.apolloassistant.app',
    oidcAuthorizeUrl: 'https://auth.apolloassistant.app/authorize',
  };
  const managed = createEgressPolicy(() => [], { mode: () => 'managed', hosts });
  const byok = createEgressPolicy(() => [], { mode: () => 'byok', hosts });

  it('managed mode reaches the backend and the identity provider', () => {
    expect(managed.isAllowedUrl('https://api.apolloassistant.app/v1/llm')).toBe(true);
    expect(managed.isAllowedUrl('https://auth.apolloassistant.app/authorize?x=1')).toBe(true);
  });

  it('managed mode cannot reach a provider directly', () => {
    // The point is capability, not credentials: a managed build has no key for
    // these hosts, and must not retain the ability to try.
    expect(managed.isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(false);
    expect(managed.isAllowedUrl('https://api.search.brave.com/res/v1/web/search')).toBe(false);
  });

  it('managed mode keeps Deepgram, because managed STT streams there directly', () => {
    // The backend mints a short-lived scoped token; proxying the audio socket
    // itself would add a round trip to every utterance.
    expect(managed.isAllowedUrl('https://api.deepgram.com/v1/listen')).toBe(true);
  });

  it('managed mode keeps the keyless and user-connected hosts', () => {
    for (const url of [
      'https://api.open-meteo.com/v1/forecast',
      'https://geocoding-api.open-meteo.com/v1/search',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      'https://www.googleapis.com/calendar/v3/calendars',
      'https://oauth2.googleapis.com/token',
      'https://accounts.google.com/o/oauth2/v2/auth',
      'https://speech.platform.bing.com/consumer/speech/synthesize',
    ]) {
      expect(managed.isAllowedUrl(url)).toBe(true);
    }
  });

  it('BYOK keeps the original Phase 0-11 list unchanged', () => {
    for (const h of BASE_ALLOWED_HOSTS) {
      expect(byok.isAllowedUrl(`https://${h}/x`)).toBe(true);
    }
  });

  it('BYOK does not gain the backend hosts it never calls', () => {
    expect(byok.isAllowedUrl('https://api.apolloassistant.app/v1/llm')).toBe(false);
  });

  it('a mode switch takes effect without rebuilding the policy', () => {
    let mode: 'managed' | 'byok' = 'managed';
    const live = createEgressPolicy(() => [], { mode: () => mode, hosts });
    expect(live.isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(false);
    mode = 'byok';
    expect(live.isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it('user feed hosts are additive in both modes, and https is still required', () => {
    const withFeeds = createEgressPolicy(() => ['feeds.example.com'], { mode: () => 'managed', hosts });
    expect(withFeeds.isAllowedUrl('https://feeds.example.com/rss')).toBe(true);
    expect(withFeeds.isAllowedUrl('http://feeds.example.com/rss')).toBe(false);
    expect(withFeeds.isAllowedUrl('https://evil.example.com/rss')).toBe(false);
  });

  it('a self-hosted backend is allowed by config, not by a hardcoded host', () => {
    const selfHosted = createEgressPolicy(() => [], {
      mode: () => 'managed',
      hosts: { backendBaseUrl: 'https://apollo.mycompany.internal', oidcAuthorizeUrl: 'https://sso.mycompany.internal/authorize' },
    });
    expect(selfHosted.isAllowedUrl('https://apollo.mycompany.internal/v1/llm')).toBe(true);
    expect(selfHosted.isAllowedUrl('https://api.apolloassistant.app/v1/llm')).toBe(false);
  });

  it('omitting the mode preserves the pre-L6 behavior', () => {
    // Callers that predate L6 (and the tools' own fetches) must not be
    // silently narrowed into a smaller allowlist.
    const legacy = createEgressPolicy(() => []);
    expect(legacy.isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(true);
  });
});
