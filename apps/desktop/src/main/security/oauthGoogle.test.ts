import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makePkcePair, runOAuthFlow, refreshAccessToken } from './oauthGoogle';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('Google OAuth PKCE (C13)', () => {
  it('produces a verifier and an S256 challenge derived from it', () => {
    const { verifier, challenge } = makePkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(base64url(createHash('sha256').update(verifier).digest()));
    expect(challenge).not.toContain('=');
  });

  it('runs the loopback flow: opens the consent URL, exchanges the code for tokens', async () => {
    let authUrl = '';
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://oauth2.googleapis.com/token');
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'gmail.send' }), { status: 200 });
    }) as unknown as typeof fetch;

    const openExternal = (url: string): void => {
      authUrl = url;
      // Simulate the browser redirecting to the loopback callback with a code.
      const redirect = decodeURIComponent(new URL(url).searchParams.get('redirect_uri') ?? '');
      const state = new URL(url).searchParams.get('state') ?? '';
      void fetch(`${redirect}?code=test-code&state=${state}`).catch(() => undefined);
    };

    const tokens = await runOAuthFlow({ clientId: 'cid', clientSecret: 'secret', fetchFn, openExternal });
    expect(authUrl).toContain('accounts.google.com');
    expect(authUrl).toContain('code_challenge_method=S256');
    expect(authUrl).toContain('gmail.readonly');
    expect(authUrl).toContain('gmail.send');
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
  });

  it('rejects on a state mismatch (CSRF guard)', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const openExternal = (url: string): void => {
      const redirect = decodeURIComponent(new URL(url).searchParams.get('redirect_uri') ?? '');
      void fetch(`${redirect}?code=x&state=WRONG`).catch(() => undefined);
    };
    await expect(runOAuthFlow({ clientId: 'c', clientSecret: 's', fetchFn, openExternal }, 5000)).rejects.toThrow(/state mismatch/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refreshes an access token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
    const out = await refreshAccessToken(fetchFn, { clientId: 'c', clientSecret: 's' }, 'rt');
    expect(out.accessToken).toBe('new-at');
    expect(out.expiresAt).toBeGreaterThan(Date.now());
  });
});
