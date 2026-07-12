import { describe, expect, it, vi } from 'vitest';
import { createEgressPolicy } from './egress';
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
