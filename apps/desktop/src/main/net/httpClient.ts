import { AppError } from '@apollo/shared';
import { type EgressPolicy, hostOf } from './egress';
import { type Breaker } from './breaker';

/**
 * C15 single http client: 10s default timeout; up to 3 retries with exponential
 * backoff + jitter on 429/5xx/network errors for idempotent (GET) requests;
 * every request passes the egress allowlist and the per-host breaker.
 */
export interface HttpClient {
  getJson(url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<unknown>;
  getText(url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<string>;
  postJson(url: string, body: unknown, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<unknown>;
}

export interface HttpDeps {
  egress: EgressPolicy;
  breaker: Breaker;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createHttpClient(deps: HttpDeps): HttpClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const doSleep = deps.sleepFn ?? sleep;

  async function request(method: 'GET' | 'POST', url: string, init: { headers?: Record<string, string>; timeoutMs?: number; body?: string } = {}): Promise<Response> {
    if (!deps.egress.isAllowedUrl(url)) {
      deps.log?.(`egress blocked: ${url}`);
      throw new AppError('INTERNAL', `egress blocked for ${hostOf(url) ?? 'invalid url'}`);
    }
    const host = hostOf(url) as string;
    const retriable = method === 'GET';
    let lastErr: unknown;

    for (let attempt = 0; attempt <= (retriable ? MAX_RETRIES : 0); attempt++) {
      if (!deps.breaker.canRequest(host)) throw new AppError('OFFLINE', `circuit open for ${host}`);
      if (attempt > 0) {
        const backoff = 300 * 2 ** (attempt - 1) * (0.5 + Math.random());
        await doSleep(backoff);
      }
      try {
        const res = await fetchFn(url, {
          method,
          headers: init.headers,
          body: init.body,
          signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status >= 500) {
          deps.breaker.recordFailure(host);
          lastErr = new AppError(res.status === 429 ? 'RATE_LIMITED' : 'TOOL_FAIL', `http ${res.status} from ${host}`);
          continue;
        }
        deps.breaker.recordSuccess(host);
        return res;
      } catch (e) {
        if (e instanceof AppError) throw e;
        deps.breaker.recordFailure(host);
        lastErr = e;
      }
    }
    throw lastErr instanceof AppError ? lastErr : new AppError('OFFLINE', `network failure for ${host}`, lastErr);
  }

  return {
    async getJson(url, init) {
      const res = await request('GET', url, init);
      if (!res.ok) throw new AppError(res.status === 401 || res.status === 403 ? 'KEY_INVALID' : 'TOOL_FAIL', `http ${res.status}`);
      return res.json();
    },
    async getText(url, init) {
      const res = await request('GET', url, init);
      if (!res.ok) throw new AppError('TOOL_FAIL', `http ${res.status}`);
      return res.text();
    },
    async postJson(url, body, init) {
      const res = await request('POST', url, {
        ...init,
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
      if (!res.ok) throw new AppError(res.status === 401 || res.status === 403 ? 'KEY_INVALID' : 'TOOL_FAIL', `http ${res.status}`);
      return res.json();
    },
  };
}
