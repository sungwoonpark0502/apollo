import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

/**
 * C13 Gmail OAuth: installed-app, Authorization Code + PKCE, loopback redirect
 * http://127.0.0.1:{ephemeral}, scopes exactly gmail.readonly gmail.send.
 * Tokens are handed back to the caller which stores them via safeStorage.
 */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  openExternal?: (url: string) => void;
  fetchFn?: typeof fetch;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Runs the loopback OAuth dance; resolves with tokens or rejects on denial/timeout. */
export async function runOAuthFlow(cfg: OAuthConfig, timeoutMs = 180_000): Promise<OAuthTokens> {
  const fetchFn = cfg.fetchFn ?? fetch;
  // electron is imported lazily so this module is unit-testable outside Electron.
  const openExternal =
    cfg.openExternal ??
    ((url: string) => {
      void import('electron').then(({ shell }) => shell.openExternal(url));
    });
  const { verifier, challenge } = makePkcePair();
  const state = base64url(randomBytes(16));

  return new Promise<OAuthTokens>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif">Apollo is connected. You can close this tab.</body></html>');
      cleanup();

      if (url.searchParams.get('error')) return reject(new Error(`oauth denied: ${url.searchParams.get('error')}`));
      if (!code || returnedState !== state) return reject(new Error('oauth state mismatch'));

      const redirectUri = `http://127.0.0.1:${port}/callback`;
      void exchangeCode(fetchFn, cfg, code, verifier, redirectUri).then(resolve, reject);
    });

    let port = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('oauth timed out'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      server.close();
    }

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `${AUTH_ENDPOINT}?response_type=code&access_type=offline&prompt=consent` +
        `&client_id=${encodeURIComponent(cfg.clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(GMAIL_SCOPES.join(' '))}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
      openExternal(authUrl);
    });

    server.on('error', (e) => {
      cleanup();
      reject(e);
    });
  });
}

async function exchangeCode(
  fetchFn: typeof fetch,
  cfg: OAuthConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const res = await fetchFn(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

export async function refreshAccessToken(
  fetchFn: typeof fetch,
  cfg: { clientId: string; clientSecret: string },
  refreshToken: string,
): Promise<Pick<OAuthTokens, 'accessToken' | 'expiresAt'>> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetchFn(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}
