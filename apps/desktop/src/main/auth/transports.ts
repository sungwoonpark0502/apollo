import { AppError, searchResponseSchema, sttTokenSchema, type SearchResponse } from '@apollo/shared';

/**
 * L0.2 managed-mode transports for the non-LLM providers. Each keeps the same
 * shape the existing adapters expect, so tools and voice code are unchanged:
 * STT gets a credential accessor (now a short-lived scoped token minted by the
 * backend), and search gets a plain query→results function.
 */
export interface ManagedTransportDeps {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Mints (and briefly caches) a scoped Deepgram token. The 60s server TTL is
 * respected with a safety margin so a session never opens with a dead token.
 */
export function createBackendSttToken(deps: ManagedTransportDeps): () => Promise<string | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && now() < cached.expiresAt) return cached.token;
    const session = await deps.getAccessToken();
    if (!session) throw new AppError('AUTH_REQUIRED', 'sign in to use voice');
    const res = await fetchFn(`${deps.baseUrl}/v1/stt`, { method: 'POST', headers: { authorization: `Bearer ${session}` } });
    if (res.status === 401) throw new AppError('AUTH_REQUIRED', 'session expired');
    if (res.status === 429) throw new AppError('QUOTA_EXCEEDED', '');
    if (!res.ok) throw new AppError('STT_DOWN', `stt token mint ${res.status}`);
    const parsed = sttTokenSchema.safeParse(await res.json());
    if (!parsed.success) throw new AppError('STT_DOWN', 'malformed stt token');
    // Renew a few seconds early rather than racing the server's expiry.
    cached = { token: parsed.data.token, expiresAt: now() + Math.max(0, parsed.data.expiresIn - 10) * 1000 };
    return cached.token;
  };
}

export function createBackendSearch(deps: ManagedTransportDeps): (query: string) => Promise<SearchResponse> {
  const fetchFn = deps.fetchFn ?? fetch;
  return async (query: string) => {
    const session = await deps.getAccessToken();
    if (!session) throw new AppError('AUTH_REQUIRED', 'sign in to search the web');
    const res = await fetchFn(`${deps.baseUrl}/v1/search?q=${encodeURIComponent(query)}`, {
      headers: { authorization: `Bearer ${session}` },
    });
    if (res.status === 401) throw new AppError('AUTH_REQUIRED', 'session expired');
    if (res.status === 429) throw new AppError('QUOTA_EXCEEDED', '');
    if (!res.ok) throw new AppError('TOOL_FAIL', `search ${res.status}`);
    const parsed = searchResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new AppError('TOOL_FAIL', 'malformed search response');
    return parsed.data;
  };
}
