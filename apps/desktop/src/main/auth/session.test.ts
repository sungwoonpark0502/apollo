import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type TokenResponse } from '@apollo/shared';
import { createSession, type AuthState } from './session';
import { byokAllowedFromEnv, resolveMode } from './mode';
import { createBackendSttToken, createBackendSearch } from './transports';

/** L7 auth state machine: sign-in, silent refresh, refresh-failure, logout. */
const BASE = 'https://api.apollo.test';

const USER = { id: 'usr_1', name: 'James', email: 'james@example.com', plan: 'free' };
const session1: TokenResponse = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900, user: USER };
const session2: TokenResponse = { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900, user: USER };

let stored: string | null;
let states: AuthState[];
let clock: number;

function harness(over: Partial<Parameters<typeof createSession>[0]> = {}) {
  return createSession({
    baseUrl: BASE,
    fetchFn: vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    loadRefreshToken: () => stored,
    saveRefreshToken: (t) => {
      stored = t;
    },
    runSignInFlow: async () => session1,
    onChange: (s) => states.push(s),
    now: () => clock,
    ...over,
  });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  stored = null;
  states = [];
  clock = Date.UTC(2026, 6, 18, 12, 0, 0);
});

describe('L7 sign-in', () => {
  it('signs in through the injected flow and persists only the refresh token', async () => {
    const s = harness();
    expect(s.state().status).toBe('signedOut');
    const res = await s.signIn();
    expect(res.ok).toBe(true);
    expect(s.state()).toEqual({ status: 'signedIn', user: USER });
    expect(stored).toBe('refresh-1'); // only the refresh token is persisted
    expect(states.map((x) => x.status)).toEqual(['signingIn', 'signedIn']);
    expect(await s.getAccessToken()).toBe('access-1'); // access token stays in memory
  });

  it('a failed flow returns to signedOut without persisting anything', async () => {
    const s = harness({ runSignInFlow: async () => { throw new Error('user cancelled'); } });
    expect((await s.signIn()).ok).toBe(false);
    expect(s.state().status).toBe('signedOut');
    expect(stored).toBeNull();
  });

  it('ignores a concurrent sign-in while one is in flight', async () => {
    let resolveFlow: (t: TokenResponse) => void = () => undefined;
    const s = harness({ runSignInFlow: () => new Promise<TokenResponse>((r) => { resolveFlow = r; }) });
    const first = s.signIn();
    const second = await s.signIn();
    expect(second.ok).toBe(false); // rejected: already signing in
    resolveFlow(session1);
    expect((await first).ok).toBe(true);
  });
});

describe('L7 silent refresh', () => {
  it('refreshes when the access token is near expiry and rotates the stored token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(session2)) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    clock += 15 * 60_000; // past the refresh skew
    expect(await s.getAccessToken()).toBe('access-2');
    expect(stored).toBe('refresh-2'); // rotation persisted
    expect(s.state().status).toBe('signedIn');
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(session2)) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    clock += 15 * 60_000;
    const [a, b, c] = await Promise.all([s.getAccessToken(), s.getAccessToken(), s.getAccessToken()]);
    expect([a, b, c]).toEqual(['access-2', 'access-2', 'access-2']);
    expect(fetchFn).toHaveBeenCalledTimes(1); // one network round trip, not three
  });

  it('invalid_grant transitions to signedOut and clears the stored token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 401)) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    clock += 15 * 60_000;
    expect(await s.getAccessToken()).toBeNull();
    expect(s.state().status).toBe('signedOut');
    expect(stored).toBeNull();
    expect(states.at(-1)).toEqual({ status: 'signedOut' });
  });

  it('a network failure does NOT sign the user out (keeps the refresh token for later)', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    clock += 15 * 60_000;
    expect(await s.getAccessToken()).toBeNull(); // no token right now
    expect(s.state().status).toBe('signedIn'); // but still signed in
    expect(stored).toBe('refresh-1'); // token retained for a later retry
  });
});

describe('L7 restore + logout', () => {
  it('restores a session at boot from the persisted refresh token', async () => {
    stored = 'refresh-1';
    const fetchFn = vi.fn(async () => jsonResponse(session2)) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.restore();
    expect(s.state()).toEqual({ status: 'signedIn', user: USER });
    expect(states.map((x) => x.status)).toEqual(['signingIn', 'signedIn']);
  });

  it('boots signedOut when there is no stored token, without a network call', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.restore();
    expect(s.state().status).toBe('signedOut');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('logout revokes at the backend and clears local state', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    await s.signOut();
    expect(calls).toEqual([`${BASE}/auth/logout`]);
    expect(s.state().status).toBe('signedOut');
    expect(stored).toBeNull();
  });

  it('logout still clears locally when the backend is unreachable', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const s = harness({ fetchFn });
    await s.signIn();
    await s.signOut();
    expect(s.state().status).toBe('signedOut');
    expect(stored).toBeNull();
  });
});

describe('L0.2 mode selection', () => {
  it('managed is the default; BYOK needs both the build flag and a real key', () => {
    expect(resolveMode({ allowByok: false, hasProviderKey: false })).toBe('managed');
    expect(resolveMode({ allowByok: false, hasProviderKey: true })).toBe('managed'); // stray key can't demote a managed build
    expect(resolveMode({ allowByok: true, hasProviderKey: false })).toBe('managed');
    expect(resolveMode({ allowByok: true, hasProviderKey: true })).toBe('byok');
  });

  it('reads the build flag from env', () => {
    expect(byokAllowedFromEnv({ APOLLO_ALLOW_BYOK: 'true' })).toBe(true);
    expect(byokAllowedFromEnv({ APOLLO_ALLOW_BYOK: '1' })).toBe(true);
    expect(byokAllowedFromEnv({})).toBe(false);
    expect(byokAllowedFromEnv({ APOLLO_ALLOW_BYOK: 'false' })).toBe(false);
  });
});

describe('L0.2 managed transports', () => {
  it('mints an STT token, caches it within its TTL, and re-mints after expiry', async () => {
    let minted = 0;
    const fetchFn = vi.fn(async () => {
      minted += 1;
      return jsonResponse({ token: `tok-${minted}`, expiresIn: 60, provider: 'deepgram' });
    }) as unknown as typeof fetch;
    const getToken = createBackendSttToken({ baseUrl: BASE, getAccessToken: async () => 'access-1', fetchFn, now: () => clock });
    expect(await getToken()).toBe('tok-1');
    expect(await getToken()).toBe('tok-1'); // cached
    clock += 55_000; // past TTL minus the 10s safety margin
    expect(await getToken()).toBe('tok-2');
    expect(minted).toBe(2);
  });

  it('STT and search demand a session and surface typed auth/quota errors', async () => {
    const signedOut = { baseUrl: BASE, getAccessToken: async () => null, fetchFn: vi.fn() as unknown as typeof fetch };
    await expect(createBackendSttToken(signedOut)()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(createBackendSearch(signedOut)('x')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    const quota = {
      baseUrl: BASE,
      getAccessToken: async () => 'access-1',
      fetchFn: vi.fn(async () => jsonResponse({ error: 'quota_exceeded' }, 429)) as unknown as typeof fetch,
    };
    await expect(createBackendSttToken(quota)()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await expect(createBackendSearch(quota)('x')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('search returns parsed results for a signed-in user', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ results: [{ title: 'Rain tomorrow', url: 'https://example.com', snippet: 'showers' }] }),
    ) as unknown as typeof fetch;
    const search = createBackendSearch({ baseUrl: BASE, getAccessToken: async () => 'access-1', fetchFn });
    expect((await search('rain')).results[0]).toMatchObject({ title: 'Rain tomorrow' });
  });
});
