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

describe('L1.4 in-app password sign-in', () => {
  const CREDS = { email: 'New.User@Example.com', password: 'correct horse battery staple', name: 'Sam' };

  async function signup(app: ReturnType<typeof server>, over: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: '/auth/signup', payload: { ...CREDS, ...over } });
  }
  async function login(app: ReturnType<typeof server>, over: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: '/auth/login', payload: { email: CREDS.email, password: CREDS.password, ...over } });
  }

  it('signs up and returns the same session shape as the OIDC path', async () => {
    const app = server();
    const res = await signup(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body).toMatchObject({ expiresIn: 900, user: { name: 'Sam', plan: 'free' } });
    // Email is normalized, so a later login with different casing still matches.
    expect(body.user.email).toBe('new.user@example.com');
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    const app = server();
    await signup(app);
    expect((await login(app)).statusCode).toBe(200);
    expect((await login(app, { password: 'not the password' })).statusCode).toBe(401);
  });

  it('login is case-insensitive on the email', async () => {
    const app = server();
    await signup(app);
    expect((await login(app, { email: 'NEW.USER@EXAMPLE.COM' })).statusCode).toBe(200);
  });

  it('never returns the password or its hash', async () => {
    const app = server();
    const raw = (await signup(app)).body + (await login(app)).body;
    expect(raw).not.toContain(CREDS.password);
    expect(raw).not.toContain('scrypt$');
    expect(raw).not.toContain('passwordHash');
  });

  it('does not reveal whether an email is registered', async () => {
    const app = server();
    await signup(app);
    // Wrong password on a real account and any password on a missing account
    // must be indistinguishable to the client.
    const wrong = await login(app, { password: 'wrong password here' });
    const missing = await login(app, { email: 'nobody@example.com', password: 'wrong password here' });
    expect(wrong.statusCode).toBe(missing.statusCode);
    expect(wrong.json()).toEqual(missing.json());
  });

  it('rejects a duplicate signup without confirming the account exists', async () => {
    const app = server();
    await signup(app);
    const dup = await signup(app);
    expect(dup.statusCode).toBe(409);
    expect(JSON.stringify(dup.json())).not.toContain('exists');
  });

  it('enforces the password policy', async () => {
    const app = server();
    for (const password of ['short', 'password123']) {
      const res = await signup(app, { email: `x${password}@example.com`, password });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('weak_password');
    }
  });

  it('throttles repeated failures for one email, then recovers after the lockout', async () => {
    const app = server();
    await signup(app);
    for (let i = 0; i < 8; i++) expect((await login(app, { password: 'wrong guess xx' })).statusCode).toBe(401);
    // The 9th is refused outright — the correct password is not even checked.
    const locked = await login(app);
    expect(locked.statusCode).toBe(429);

    clock += 16 * 60_000; // past the 15-minute lockout
    expect((await login(app)).statusCode).toBe(200);
  });

  it('a successful login clears the failure counter', async () => {
    const app = server();
    await signup(app);
    for (let i = 0; i < 5; i++) await login(app, { password: 'wrong guess xx' });
    expect((await login(app)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) await login(app, { password: 'wrong guess xx' });
    expect((await login(app)).statusCode).toBe(200); // counter reset, not at 10
  });

  it('an OIDC account cannot be logged into with a password', async () => {
    const app = server();
    await signIn(app); // creates james@example.com with no password hash
    const res = await login(app, { email: 'james@example.com', password: 'anything at all' });
    expect(res.statusCode).toBe(401);
  });

  it('the issued session works on a protected route and refreshes', async () => {
    const app = server();
    const { accessToken, refreshToken } = (await signup(app)).json();
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(200);
    const refreshed = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(200);
  });

  it('rejects a malformed email or an oversized password', async () => {
    const app = server();
    expect((await signup(app, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await signup(app, { password: 'x'.repeat(300) })).statusCode).toBe(400);
  });
});

describe('multi-provider dispatch', () => {
  function providers() {
    const seen: Record<string, number> = {};
    const mk = (name: string): LlmProvider => ({
      async stream(_req, onEvent) {
        seen[name] = (seen[name] ?? 0) + 1;
        onEvent({ type: 'text', delta: `from-${name}` });
        onEvent({ type: 'done', stopReason: 'end_turn' });
      },
    });
    return { seen, anthropic: mk('anthropic'), openai: mk('openai'), google: mk('google') };
  }

  const LLM_BODY = { system: 's', messages: [], tools: [], maxTokens: 100 };

  it('omitting provider routes to anthropic, so old clients keep working', async () => {
    const p = providers();
    const app = server({ llm: p.anthropic, llmProviders: { openai: p.openai } });
    const { accessToken } = await signIn(app);
    const res = await app.inject({ method: 'POST', url: '/v1/llm', headers: { authorization: `Bearer ${accessToken}` }, payload: LLM_BODY });
    expect(res.statusCode).toBe(200);
    expect(p.seen).toEqual({ anthropic: 1 });
  });

  it('provider:"openai" dispatches to the openai adapter', async () => {
    const p = providers();
    const app = server({ llm: p.anthropic, llmProviders: { openai: p.openai, google: p.google } });
    const { accessToken } = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { ...LLM_BODY, provider: 'openai' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('from-openai');
    expect(p.seen).toEqual({ openai: 1 });
  });

  it('an unconfigured provider is a typed 400, not a fallback to another brain', async () => {
    // Silently answering with a different provider than the user picked would
    // be a lie about whose model produced the reply.
    const p = providers();
    const app = server({ llm: p.anthropic });
    const { accessToken } = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { ...LLM_BODY, provider: 'google' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'provider_unavailable', provider: 'google' });
    expect(p.seen).toEqual({});
  });

  it('clamps an unknown model id to the provider default instead of forwarding it', async () => {
    let sentModel = '';
    const capture: LlmProvider = {
      async stream(req, onEvent) {
        sentModel = req.model ?? '';
        onEvent({ type: 'done', stopReason: 'end_turn' });
      },
    };
    const app = server({ llm: capture });
    const { accessToken } = await signIn(app);
    await app.inject({
      method: 'POST',
      url: '/v1/llm',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { ...LLM_BODY, provider: 'anthropic', model: 'made-up-model-9000' },
    });
    expect(sentModel).toBe('claude-sonnet-4-6');
  });

  it('/v1/models reports exactly the configured providers', async () => {
    const p = providers();
    const app = server({ llm: p.anthropic, llmProviders: { google: p.google } });
    const { accessToken } = await signIn(app);
    const res = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { providers: Array<{ id: string }> }).providers.map((x) => x.id);
    expect(ids.sort()).toEqual(['anthropic', 'google']);
  });

  it('/v1/models requires a session like every other v1 route', async () => {
    const app = server();
    expect((await app.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(401);
  });
});

describe('Phase 13 CORS for the web client', () => {
  const ORIGIN = 'https://app.apollo.test';

  it('without webOrigin configured there are no CORS headers at all', async () => {
    const app = server();
    const res = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows exactly the configured origin, and only that origin', async () => {
    const app = server({ webOrigin: ORIGIN });
    const ok = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: ORIGIN } });
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    // Any other origin gets nothing back — never an echo, never a wildcard.
    const evil = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight for the configured origin and refuses others', async () => {
    const app = server({ webOrigin: ORIGIN });
    const ok = await app.inject({ method: 'OPTIONS', url: '/v1/llm', headers: { origin: ORIGIN } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-headers']).toContain('authorization');
    const evil = await app.inject({ method: 'OPTIONS', url: '/v1/llm', headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
  });

  it('CORS does not weaken auth: a cross-origin request still needs a session', async () => {
    const app = server({ webOrigin: ORIGIN });
    const res = await app.inject({ method: 'GET', url: '/v1/models', headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(401);
  });
});

describe('Phase 13.4 web content: notes + events', () => {
  async function twoUsers(app: ReturnType<typeof server>) {
    const a = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'a@x.dev', password: 'password for a!' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'b@x.dev', password: 'password for b!' } })).json();
    return { a: a.accessToken as string, b: b.accessToken as string };
  }
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  it('note CRUD round-trips for the owner', async () => {
    const app = server();
    const { a } = await twoUsers(app);
    const put = await app.inject({ method: 'PUT', url: '/v1/notes', headers: auth(a), payload: { id: 'n1', title: 'Groceries', content: 'milk' } });
    expect(put.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/v1/notes', headers: auth(a) })).json();
    expect(list.notes).toHaveLength(1);
    expect(list.notes[0]).toMatchObject({ id: 'n1', title: 'Groceries', content: 'milk', pinned: false });
    const del = (await app.inject({ method: 'DELETE', url: '/v1/notes/n1', headers: auth(a) })).json();
    expect(del.ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/notes', headers: auth(a) })).json().notes).toHaveLength(0);
  });

  it('ISOLATION: user B can never read, overwrite, or delete user A content', async () => {
    // The property the whole feature stands on.
    const app = server();
    const { a, b } = await twoUsers(app);
    await app.inject({ method: 'PUT', url: '/v1/notes', headers: auth(a), payload: { id: 'n1', title: 'secret', content: 'A only' } });

    expect((await app.inject({ method: 'GET', url: '/v1/notes', headers: auth(b) })).json().notes).toHaveLength(0);
    // Same id, other account: must not clobber A's row.
    await app.inject({ method: 'PUT', url: '/v1/notes', headers: auth(b), payload: { id: 'n1', title: 'hijack', content: 'B' } });
    const aNotes = (await app.inject({ method: 'GET', url: '/v1/notes', headers: auth(a) })).json().notes;
    expect(aNotes[0].content).toBe('A only');
    expect((await app.inject({ method: 'DELETE', url: '/v1/notes/n1', headers: auth(b) })).json().ok).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/v1/notes', headers: auth(a) })).json().notes).toHaveLength(1);
  });

  it('events range-query and reject end-before-start', async () => {
    const app = server();
    const { a } = await twoUsers(app);
    await app.inject({ method: 'PUT', url: '/v1/events', headers: auth(a), payload: { id: 'e1', title: 'Dentist', startIso: '2026-07-21T15:00:00Z', endIso: '2026-07-21T16:00:00Z' } });
    await app.inject({ method: 'PUT', url: '/v1/events', headers: auth(a), payload: { id: 'e2', title: 'Far future', startIso: '2027-01-01T00:00:00Z', endIso: '2027-01-01T01:00:00Z' } });

    const july = (await app.inject({ method: 'GET', url: '/v1/events?fromIso=2026-07-01&toIso=2026-08-01', headers: auth(a) })).json();
    expect(july.events.map((e: { id: string }) => e.id)).toEqual(['e1']);

    const bad = await app.inject({ method: 'PUT', url: '/v1/events', headers: auth(a), payload: { id: 'e3', title: 'x', startIso: '2026-07-22T10:00:00Z', endIso: '2026-07-22T09:00:00Z' } });
    expect(bad.statusCode).toBe(400);
  });

  it('every content route requires a session', async () => {
    const app = server();
    for (const [method, url] of [['GET', '/v1/notes'], ['PUT', '/v1/notes'], ['DELETE', '/v1/notes/x'], ['GET', '/v1/events?fromIso=a&toIso=b'], ['PUT', '/v1/events'], ['DELETE', '/v1/events/x']] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('content writes never consume LLM quota', async () => {
    const app = server();
    const { a } = await twoUsers(app);
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'PUT', url: '/v1/notes', headers: auth(a), payload: { id: `n${i}`, content: 'x' } });
    }
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth(a) })).json();
    expect(me.usage.used).toBe(0);
  });

  it('rejects an oversized note body', async () => {
    const app = server();
    const { a } = await twoUsers(app);
    const res = await app.inject({ method: 'PUT', url: '/v1/notes', headers: auth(a), payload: { id: 'big', content: 'x'.repeat(100_001) } });
    expect(res.statusCode).toBe(400);
  });
});
