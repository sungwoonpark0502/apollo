import { tokenResponseSchema, type TokenResponse } from '@apollo/shared';

/**
 * L1 client session lifecycle. The access (session) token lives only in memory;
 * only the rotating refresh token is persisted, via safeStorage. Renderers
 * never see either — every provider call happens in main. On access-token
 * expiry we silently exchange the refresh token; on refresh failure or
 * invalid_grant we transition to signedOut and surface a non-blocking prompt.
 */
export type AuthStatus = 'signedOut' | 'signingIn' | 'signedIn';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  plan: string;
}

export interface AuthState {
  status: AuthStatus;
  user?: AuthUser;
}

export interface SessionDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  /** Persisted refresh token (safeStorage-backed); null when signed out. */
  loadRefreshToken: () => string | null;
  saveRefreshToken: (token: string | null) => void;
  /** Runs the RFC 8252 system-browser PKCE flow, returning the backend session. */
  runSignInFlow: () => Promise<TokenResponse>;
  onChange: (state: AuthState) => void;
  now?: () => number;
  log?: (msg: string) => void;
}

/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

export function createSession(deps: SessionDeps) {
  const now = deps.now ?? Date.now;
  let status: AuthStatus = 'signedOut';
  let user: AuthUser | undefined;
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let inflightRefresh: Promise<string | null> | null = null;

  function emit(): void {
    deps.onChange({ status, ...(user ? { user } : {}) });
  }

  function setSignedIn(res: TokenResponse): void {
    accessToken = res.accessToken;
    accessExpiresAt = now() + res.expiresIn * 1000;
    user = res.user;
    deps.saveRefreshToken(res.refreshToken);
    status = 'signedIn';
    emit();
  }

  function setSignedOut(): void {
    accessToken = null;
    accessExpiresAt = 0;
    user = undefined;
    deps.saveRefreshToken(null);
    status = 'signedOut';
    emit();
  }

  /** Exchanges the stored refresh token for a new session. null = failed. */
  async function refresh(): Promise<string | null> {
    const refreshToken = deps.loadRefreshToken();
    if (!refreshToken) {
      setSignedOut();
      return null;
    }
    try {
      const res = await deps.fetchFn(`${deps.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // invalid_grant (rotated/revoked/expired) → signed out, non-blocking.
        deps.log?.(`auth refresh rejected: ${res.status}`);
        setSignedOut();
        return null;
      }
      const parsed = tokenResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setSignedOut();
        return null;
      }
      setSignedIn(parsed.data);
      return parsed.data.accessToken;
    } catch (e) {
      // Network failure is NOT a sign-out: keep the refresh token and retry later.
      deps.log?.(`auth refresh failed (network): ${e instanceof Error ? e.message : String(e)}`);
      accessToken = null;
      accessExpiresAt = 0;
      return null;
    }
  }

  return {
    state(): AuthState {
      return { status, ...(user ? { user } : {}) };
    },

    /** Restores a session at boot from the persisted refresh token. */
    async restore(): Promise<void> {
      if (!deps.loadRefreshToken()) {
        status = 'signedOut';
        emit();
        return;
      }
      status = 'signingIn';
      emit();
      const token = await refresh();
      // refresh() already signed us out on invalid_grant. A null result with the
      // token still present means a network failure at boot: present as signed
      // out, but keep the token so a later retry can restore the session.
      if (!token && deps.loadRefreshToken()) {
        status = 'signedOut';
        emit();
      }
    },

    /** L1 sign-in: opens the system browser (never an embedded web view). */
    async signIn(): Promise<{ ok: boolean }> {
      if (status === 'signingIn') return { ok: false };
      status = 'signingIn';
      user = undefined;
      emit();
      try {
        setSignedIn(await deps.runSignInFlow());
        return { ok: true };
      } catch (e) {
        deps.log?.(`sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
        setSignedOut();
        return { ok: false };
      }
    },

    /** Invalidates the refresh token at the backend, then clears local state. */
    async signOut(): Promise<void> {
      const token = accessToken;
      if (token) {
        try {
          await deps.fetchFn(`${deps.baseUrl}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
        } catch {
          /* best effort: local sign-out proceeds regardless */
        }
      }
      setSignedOut();
    },

    /**
     * A valid access token, refreshing silently when expired/near-expiry.
     * Concurrent callers share one in-flight refresh.
     */
    async getAccessToken(): Promise<string | null> {
      if (accessToken && now() < accessExpiresAt - REFRESH_SKEW_MS) return accessToken;
      if (!inflightRefresh) {
        inflightRefresh = refresh().finally(() => {
          inflightRefresh = null;
        });
      }
      return inflightRefresh;
    },
  };
}

export type Session = ReturnType<typeof createSession>;
