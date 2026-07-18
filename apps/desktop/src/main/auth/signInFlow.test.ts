import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makePkcePair, runSignInFlow } from './signInFlow';

/**
 * L6 RFC 8252 compliance: login opens the SYSTEM BROWSER (never an embedded web
 * view), uses Authorization Code + PKCE with S256, redirects to an ephemeral
 * loopback listener, and validates `state` before exchanging the code.
 */
const CFG = {
  baseUrl: 'https://api.apollo.test',
  authorizeUrl: 'https://id.apollo.test/authorize',
  clientId: 'apollo-desktop',
};

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
  user: { id: 'usr_1', name: 'James', email: 'james@example.com', plan: 'free' },
};

function base64urlOf(input: string): string {
  return createHash('sha256').update(input).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Drives the flow: captures the authorize URL, then hits the loopback callback. */
async function drive(
  callback: (params: { url: URL; redirect: string }) => string,
  fetchImpl?: typeof fetch,
): Promise<{ result: Promise<unknown>; authorizeUrl: URL }> {
  let resolveUrl: (u: URL) => void = () => undefined;
  const captured = new Promise<URL>((r) => {
    resolveUrl = r;
  });

  const result = runSignInFlow({
    ...CFG,
    timeoutMs: 5000,
    fetchFn: fetchImpl ?? ((async () => new Response(JSON.stringify(TOKENS), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch),
    openExternal: (url) => resolveUrl(new URL(url)),
  });
  result.catch(() => undefined); // handled by callers

  const authorizeUrl = await captured;
  const redirect = authorizeUrl.searchParams.get('redirect_uri')!;
  const target = callback({ url: authorizeUrl, redirect });
  await fetch(target).catch(() => undefined); // hit the loopback listener
  return { result, authorizeUrl };
}

describe('L6 RFC 8252 native-app login', () => {
  it('opens the system browser with code+PKCE(S256) and a loopback redirect', async () => {
    const { result, authorizeUrl } = await drive(({ url, redirect }) => {
      const state = url.searchParams.get('state')!;
      return `${redirect}?code=good-code&state=${encodeURIComponent(state)}`;
    });
    await result;

    // System browser, not an embedded view: the only navigation is openExternal.
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(CFG.authorizeUrl);
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
    // Loopback redirect on an ephemeral port (RFC 8252 §7.3).
    const redirect = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/callback');
    expect(Number(redirect.port)).toBeGreaterThan(0);
  });

  it('exchanges the code at the BACKEND with the PKCE verifier, and returns the session', async () => {
    let body: { code: string; codeVerifier: string; redirectUri: string } | null = null;
    let exchangeUrl = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      exchangeUrl = url;
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(TOKENS), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const { result, authorizeUrl } = await drive(({ url, redirect }) => {
      const state = url.searchParams.get('state')!;
      return `${redirect}?code=good-code&state=${encodeURIComponent(state)}`;
    }, fetchImpl);

    expect(await result).toEqual(TOKENS);
    expect(exchangeUrl).toBe(`${CFG.baseUrl}/auth/token`); // backend, not the IdP
    expect(body!.code).toBe('good-code');
    // The verifier must hash to the challenge that was sent (real PKCE binding).
    expect(base64urlOf(body!.codeVerifier)).toBe(authorizeUrl.searchParams.get('code_challenge'));
    expect(new URL(body!.redirectUri).hostname).toBe('127.0.0.1');
  });

  it('rejects a mismatched state without exchanging the code (CSRF guard)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const { result } = await drive(({ redirect }) => `${redirect}?code=good-code&state=forged`, fetchImpl);
    await expect(result).rejects.toThrow(/state mismatch/);
    expect(fetchImpl).not.toHaveBeenCalled(); // never exchanged
  });

  it('rejects a provider error redirect', async () => {
    const { result } = await drive(({ redirect }) => `${redirect}?error=access_denied`);
    await expect(result).rejects.toThrow(/access_denied/);
  });

  it('rejects a callback with no code', async () => {
    const { result } = await drive(({ url, redirect }) => {
      const state = url.searchParams.get('state')!;
      return `${redirect}?state=${encodeURIComponent(state)}`;
    });
    await expect(result).rejects.toThrow(/no code/);
  });

  it('surfaces a failed backend exchange', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const { result } = await drive(({ url, redirect }) => {
      const state = url.searchParams.get('state')!;
      return `${redirect}?code=good-code&state=${encodeURIComponent(state)}`;
    }, fetchImpl);
    await expect(result).rejects.toThrow(/code exchange failed: 401/);
  });
});

describe('PKCE pair', () => {
  it('produces an RFC 7636-length verifier whose S256 hash is the challenge', () => {
    const { verifier, challenge } = makePkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/); // unreserved chars only
    expect(base64urlOf(verifier)).toBe(challenge);
  });

  it('is unique per call', () => {
    expect(makePkcePair().verifier).not.toBe(makePkcePair().verifier);
  });
});
