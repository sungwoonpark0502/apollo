import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tokenResponseSchema, type TokenResponse } from '@apollo/shared';

/**
 * L1 / RFC 8252 native-app sign-in. Authorization Code + PKCE, opened in the
 * SYSTEM BROWSER (never an embedded web view), redirecting to an ephemeral
 * loopback listener on 127.0.0.1. The code is exchanged at the Apollo backend
 * (which holds the client secret, if any) — the desktop app never handles
 * passwords and never sees a provider key.
 */
export interface SignInFlowConfig {
  /** Apollo backend base URL (code exchange happens there). */
  baseUrl: string;
  /** Hosted identity provider authorize endpoint. */
  authorizeUrl: string;
  clientId: string;
  scope?: string;
  fetchFn?: typeof fetch;
  /** Injected for tests; production opens the OS browser via shell.openExternal. */
  openExternal?: (url: string) => void;
  timeoutMs?: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makePkcePair(): { verifier: string; challenge: string } {
  // RFC 7636: 43-128 chars. 32 random bytes → 43 base64url chars.
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Constant-time compare so a returned state can't be probed byte-by-byte. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const DONE_PAGE = '<html><body style="font-family:system-ui;padding:40px">You are signed in to Apollo. You can close this tab.</body></html>';

export async function runSignInFlow(cfg: SignInFlowConfig): Promise<TokenResponse> {
  const fetchFn = cfg.fetchFn ?? fetch;
  const openExternal =
    cfg.openExternal ??
    ((url: string) => {
      // Lazy import keeps this module unit-testable outside Electron.
      void import('electron').then(({ shell }) => shell.openExternal(url));
    });
  const timeoutMs = cfg.timeoutMs ?? 180_000;
  const { verifier, challenge } = makePkcePair();
  const state = base64url(randomBytes(16));

  return new Promise<TokenResponse>((resolve, reject) => {
    let port = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(DONE_PAGE);
      cleanup();

      if (error) return reject(new Error(`sign-in denied: ${error}`));
      if (!code) return reject(new Error('sign-in returned no code'));
      if (!returnedState || !safeEqual(returnedState, state)) return reject(new Error('sign-in state mismatch'));

      // Exchange at the BACKEND (not the IdP): the backend mints the Apollo session.
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      void fetchFn(`${cfg.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`code exchange failed: ${r.status}`);
          const parsed = tokenResponseSchema.safeParse(await r.json());
          if (!parsed.success) throw new Error('malformed token response');
          return parsed.data;
        })
        .then(resolve, reject);
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('sign-in timed out'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      server.close();
    }

    server.on('error', (e) => {
      cleanup();
      reject(e);
    });

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `${cfg.authorizeUrl}?response_type=code` +
        `&client_id=${encodeURIComponent(cfg.clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(cfg.scope ?? 'openid profile email offline_access')}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
      openExternal(authUrl);
    });
  });
}
