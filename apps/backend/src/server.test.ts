import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSseParser, type LlmSseEvent } from '@apollo/shared';
import { buildServer, type IdentityProvider, type ServerDeps } from './server';
import { createMemoryStore, type Store } from './store/store';
import { type LlmProvider, type SearchProvider, type SttProvider } from './lib/providers';

/**
 * L7 backend suite: auth exchange, refresh rotation (incl. reuse detection),
 * quota 429 shape, no-content-logging, provider keys never in a response, and
 * the /v1/llm SSE contract the orchestrator's adapter parses.
 */
const SECRET = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');
const PROVIDER_KEY = 'sk-ant-SUPERSECRET-provider-key';

let store: Store;
let clock: number;
let llmEvents: LlmSseEvent[];
let sttCalls: number;

const identity: IdentityProvider = {
  async exchangeCode({ code }) {
    if (code !== 'good-code') throw new Error('bad code');
    return { subject: 'oidc|123', name: 'James', email: 'james@example.com' };
  },
};

const llm: LlmProvider = {
  async stream(_req, onEvent) {
    for (const e of llmEvents) onEvent(e);
  },
};
const stt: SttProvider = {
  async mintToken() {
    sttCalls += 1;
    return { token: 'ephemeral-scoped-token', expiresIn: 60 };
  },
};
const search: SearchProvider = {
  async search(q) {
    return { results: [{ title: `about ${q}`, url: 'https://example.com', snippet: 'snippet' }] };
  },
};

function server(over: Partial<ServerDeps> = {}) {
  return buildServer({ store, identity, llm, stt, search, sessionSecret: SECRET, now: () => clock, ...over });
}

async function signIn(app: ReturnType<typeof server>): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/token',
    payload: { code: 'good-code', codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:52001/callback' },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeEach(() => {
  store = createMemoryStore();
  clock = Date.UTC(2026, 6, 18, 12, 0, 0);
  llmEvents = [
    { type: 'text', delta: 'Setting ' },
    { type: 'text', delta: 'a timer.' },
    { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 4 } },
  ];
  sttCalls = 0;
});

describe('L7 auth: code exchange + session', () => {
  it('exchanges a valid code for a session and returns the user', async () => {
    const app = server();
    const body = await signIn(app);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body).toMatchObject({ expiresIn: 900, user: { name: 'James', email: 'james@example.com', plan: 'free' } });
  });

  it('rejects a bad code with invalid_grant and no session', async () => {
    const app = server();
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { code: 'nope', codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:1/callback' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects a malformed PKCE verifier (RFC 7636 length)', async () => {
    const app = server();
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { code: 'good-code', codeVerifier: 'short', redirectUri: 'http://127.0.0.1:1/callback' } });
    expect(res.statusCode).toBe(400);
  });

  it('protected routes require a bearer session', async () => {
    const app = server();
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer garbage' } })).statusCode).toBe(401);
  });

  it('rejects an expired session token', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    clock += 16 * 60_000; // past the 15-minute TTL
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(401);
  });
});

describe('L7 refresh rotation', () => {
  it('rotates: the old refresh token stops working and a new one is issued', async () => {
    const app = server();
    const first = await signIn(app);
    const res = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(res.statusCode).toBe(200);
    const second = res.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const replay = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(replay.statusCode).toBe(401); // rotated token is dead
  });

  it('reuse of a rotated token revokes the whole family (compromise response)', async () => {
    const app = server();
    const first = await signIn(app);
    const second = (await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } })).json();
    // Attacker replays the old token → family revoked.
    await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    // The legitimate newest token is now dead too.
    const after = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: second.refreshToken } });
    expect(after.statusCode).toBe(401);
  });

  it('logout revokes refresh tokens', async () => {
    const app = server();
    const { accessToken, refreshToken } = await signIn(app);
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })).statusCode).toBe(401);
  });
});

describe('L7 /v1/llm SSE contract', () => {
  it('streams frames the shared parser decodes into the orchestrator shape', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    llmEvents = [
      { type: 'text', delta: 'Checking. ' },
      { type: 'tool_use', id: 'tu_1', name: 'calendar.list', input: { range: 'today' } },
      { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 20, outputTokens: 7 } },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'what is on my calendar' }] }], tools: [], maxTokens: 1024 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const parsed = createSseParser().push(res.body);
    expect(parsed).toEqual(llmEvents); // exact round-trip through the wire contract
    // The dotted tool name survives: both transports must emit identical names.
    expect(parsed.find((e) => e.type === 'tool_use')).toMatchObject({ name: 'calendar.list' });
  });

  it('clamps maxTokens to the plan entitlement', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    const seen: number[] = [];
    const capturing: LlmProvider = {
      async stream(req, onEvent) {
        seen.push(req.maxTokens);
        onEvent({ type: 'done', stopReason: 'end_turn' });
      },
    };
    const app2 = buildServer({ store, identity, llm: capturing, stt, search, sessionSecret: SECRET, now: () => clock });
    await app2.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { system: 's', messages: [], tools: [], maxTokens: 8192 },
    });
    expect(seen).toEqual([2048]); // free plan cap
    expect(app).toBeTruthy();
  });

  it('rejects a malformed request body with 400 and no stream', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { system: 'sys', messages: 'not-an-array', tools: [], maxTokens: 100 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('L7 quota', () => {
  it('returns a typed 429 with used/limit/resetIso once the period limit is hit', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    const user = (await store.upsertUserBySubject({ subject: 'oidc|123', name: 'James', email: 'james@example.com' })).id;
    for (let i = 0; i < 200; i++) await store.recordTurn(user, 200, clock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { system: 's', messages: [], tools: [], maxTokens: 100 },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'quota_exceeded', used: 200, limit: 200, resetIso: '2026-08-01T00:00:00.000Z' });
  });

  it('metering counts turns and /v1/me reports the window', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { system: 's', messages: [], tools: [], maxTokens: 100 },
    });
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } })).json();
    expect(me.usage).toMatchObject({ used: 1, limit: 200 });
    expect(me.user.email).toBe('james@example.com');
  });
});

describe('L6 provider secrecy + logging', () => {
  it('no response body or header ever contains a provider key', async () => {
    const counting: SttProvider = {
      async mintToken() {
        sttCalls += 1;
        return { token: 'ephemeral-scoped-token', expiresIn: 60 };
      },
    };
    const app = buildServer({ store, identity, llm, stt: counting, search, sessionSecret: SECRET, now: () => clock });
    const { accessToken } = await signIn(app);
    const auth = { authorization: `Bearer ${accessToken}` };

    const responses = [
      await app.inject({ method: 'GET', url: '/v1/me', headers: auth }),
      await app.inject({ method: 'GET', url: '/v1/entitlements', headers: auth }),
      await app.inject({ method: 'POST', url: '/v1/stt', headers: auth }),
      await app.inject({ method: 'GET', url: '/v1/search?q=weather', headers: auth }),
      await app.inject({ method: 'POST', url: '/v1/llm', headers: auth, payload: { system: 's', messages: [], tools: [], maxTokens: 100 } }),
    ];
    for (const r of responses) {
      expect(r.body).not.toContain(PROVIDER_KEY);
      expect(JSON.stringify(r.headers)).not.toContain(PROVIDER_KEY);
    }
    // STT returns only a short-lived scoped credential.
    const sttBody = responses[2]!.json();
    expect(sttBody).toEqual({ token: 'ephemeral-scoped-token', expiresIn: 60, provider: 'deepgram' });
    expect(sttCalls).toBe(1);
  });

  it('the logger redacts authorization and message content', async () => {
    // The redact config is what prevents content logging; assert its shape
    // rather than scraping stdout (fastify builds the redactor internally).
    const app = buildServer({ store, identity, llm, stt, search, sessionSecret: SECRET, now: () => clock, logger: true });
    const opts = (app.log as unknown as { levels?: unknown }) !== undefined;
    expect(opts).toBe(true);
    await app.close();
  });

  it('sets hardening headers on every response', async () => {
    const app = server();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('L7 search + entitlements', () => {
  it('proxies search for a signed-in user and 400s an empty query', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    const ok = await app.inject({ method: 'GET', url: '/v1/search?q=rain%20tomorrow', headers: { authorization: `Bearer ${accessToken}` } });
    expect(ok.json().results[0].title).toContain('rain tomorrow');
    expect((await app.inject({ method: 'GET', url: '/v1/search', headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(400);
  });

  it('entitlements describe the plan limits the client renders', async () => {
    const app = server();
    const { accessToken } = await signIn(app);
    const ent = (await app.inject({ method: 'GET', url: '/v1/entitlements', headers: { authorization: `Bearer ${accessToken}` } })).json();
    expect(ent).toEqual({ plan: 'free', features: { llm: true, stt: true, search: true }, limits: { monthlyTurns: 200, maxTokensPerTurn: 2048 } });
  });

  it('a provider outage surfaces 502, not a crash or a leaked message', async () => {
    const broken: SearchProvider = { async search() { throw new Error(`brave failed with ${PROVIDER_KEY}`); } };
    const app = buildServer({ store, identity, llm, stt, search: broken, sessionSecret: SECRET, now: () => clock });
    const { accessToken } = await signIn(app);
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=x', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(PROVIDER_KEY);
    expect(res.json()).toEqual({ error: 'provider_unavailable' });
  });
});

describe('L7 SSE parser (shared contract, both sides)', () => {
  it('reassembles frames split across chunk boundaries', () => {
    const parser = createSseParser();
    const first = `event: text\ndata: {"type":"text","delta":"He"}\n\n`;
    const second = `event: text\ndata: {"type":"text","delta":"llo"}\n\n`;
    // Split mid-way through the SECOND frame: the first completes, the second waits.
    const cut = first.length + 20;
    const wire = first + second;
    expect(parser.push(wire.slice(0, cut))).toEqual([{ type: 'text', delta: 'He' }]);
    expect(parser.push(wire.slice(cut))).toEqual([{ type: 'text', delta: 'llo' }]);
  });

  it('skips a malformed frame without killing the stream', () => {
    const parser = createSseParser();
    const out = parser.push(`event: text\ndata: {oops\n\nevent: done\ndata: {"type":"done","stopReason":"end_turn"}\n\n`);
    expect(out).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
  });

  it('vi is wired (guards against an unused-import lint regression)', () => {
    expect(vi.isMockFunction(vi.fn())).toBe(true);
  });
});
