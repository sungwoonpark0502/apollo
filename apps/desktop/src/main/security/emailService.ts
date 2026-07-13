import { type EmailProvider } from './emailProvider';
import { FakeEmailProvider } from './emailFake';
import { createGmailProvider } from './gmailProvider';
import { runOAuthFlow, refreshAccessToken, type OAuthTokens } from './oauthGoogle';
import { type SecretCodec } from './secrets';
import { type Repos } from '../db/repos/index';

/**
 * Manages the active EmailProvider: Gmail when connected (tokens in safeStorage
 * ciphertext, token_ref in oauth_accounts), else a FakeEmailProvider so email
 * tools degrade gracefully with a KEY_MISSING hint (C13).
 */
export interface EmailServiceDeps {
  repos: Repos;
  codec: SecretCodec;
  clientId: () => string | null;
  clientSecret: () => string | null;
  fetchFn?: typeof fetch;
  openExternal?: (url: string) => void;
  log?: (msg: string) => void;
}

const TOKEN_KEY = 'oauth.google.tokens';

export function createEmailService(deps: EmailServiceDeps) {
  function loadTokens(): (OAuthTokens & { address: string }) | null {
    const acct = deps.repos.oauth.get('google');
    if (!acct) return null;
    const cipher = deps.repos.settings.get(acct.tokenRef);
    if (!cipher) return null;
    try {
      const tokens = JSON.parse(deps.codec.decrypt(cipher)) as OAuthTokens;
      return { ...tokens, address: acct.address ?? '' };
    } catch {
      return null;
    }
  }

  function saveTokens(tokens: OAuthTokens, address: string): void {
    deps.repos.settings.set(TOKEN_KEY, deps.codec.encrypt(JSON.stringify(tokens)));
    deps.repos.oauth.upsert({ provider: 'google', address, tokenRef: TOKEN_KEY });
  }

  const gmail = createGmailProvider({
    clientId: deps.clientId() ?? '',
    clientSecret: deps.clientSecret() ?? '',
    getTokens: () => {
      const t = loadTokens();
      return t ? { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt } : null;
    },
    onTokenRefresh: (accessToken, expiresAt) => {
      const t = loadTokens();
      if (t) saveTokens({ ...t, accessToken, expiresAt }, t.address);
    },
    address: () => loadTokens()?.address ?? null,
  });

  const fake = new FakeEmailProvider(undefined, { connected: false });

  return {
    provider(): EmailProvider {
      return loadTokens() ? gmail : fake;
    },

    isConnected(): boolean {
      return loadTokens() !== null;
    },

    address(): string | null {
      return loadTokens()?.address ?? null;
    },

    async connect(): Promise<{ ok: boolean; address?: string }> {
      const clientId = deps.clientId();
      const clientSecret = deps.clientSecret();
      if (!clientId || !clientSecret) return { ok: false };
      try {
        const tokens = await runOAuthFlow(
          { clientId, clientSecret, fetchFn: deps.fetchFn, openExternal: deps.openExternal },
        );
        // fetch the address via a fresh access token (userinfo not in scope; use gmail profile)
        const address = await fetchGmailAddress(tokens.accessToken, deps.fetchFn ?? fetch).catch(() => '');
        saveTokens(tokens, address);
        return { ok: true, address };
      } catch (e) {
        deps.log?.(`oauth failed: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false };
      }
    },

    async refreshIfNeeded(): Promise<void> {
      const t = loadTokens();
      if (!t || t.expiresAt > Date.now() + 60_000) return;
      const clientId = deps.clientId();
      const clientSecret = deps.clientSecret();
      if (!clientId || !clientSecret || !t.refreshToken) return;
      try {
        const fresh = await refreshAccessToken(deps.fetchFn ?? fetch, { clientId, clientSecret }, t.refreshToken);
        saveTokens({ ...t, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt }, t.address);
      } catch (e) {
        deps.log?.(`token refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    revoke(): void {
      deps.repos.settings.delete(TOKEN_KEY);
      deps.repos.oauth.remove('google');
    },
  };
}

export type EmailService = ReturnType<typeof createEmailService>;

async function fetchGmailAddress(accessToken: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  const json = (await res.json()) as { emailAddress?: string };
  return json.emailAddress ?? '';
}
