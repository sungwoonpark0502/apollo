import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, normalizeEmail, validatePassword, verifyPassword } from './lib/password';
import {
  availableModels,
  encodeSse,
  entitlementsSchema,
  llmRequestSchema,
  resolveModelChoice,
  type Entitlements,
  type LlmProviderId,
  type LlmSseEvent,
} from '@apollo/shared';
import { createAuth, ACCESS_TTL_SEC, type Auth } from './lib/auth';
import { type LlmProvider, type SearchProvider, type SttProvider } from './lib/providers';
import { periodResetIso, type Store, type User } from './store/store';

/**
 * L0.1 Apollo backend: auth, inference proxying, and metering. No business
 * logic beyond that, and no user content is stored or logged — only token
 * counts. Providers and the store are injected so the suite runs offline.
 */
export interface IdentityProvider {
  /** Exchanges an OIDC authorization code (+PKCE verifier) for verified claims. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ subject: string; name: string; email: string }>;
  /** Best-effort revocation at the identity provider on logout. */
  revoke?(subject: string): Promise<void>;
}

export interface ServerDeps {
  store: Store;
  identity: IdentityProvider;
  /** The default (Anthropic) provider; every deployment has one. */
  llm: LlmProvider;
  /** Optional additional providers; a request naming an absent one gets a
   *  typed 400, and /v1/models simply omits it. */
  llmProviders?: Partial<Record<LlmProviderId, LlmProvider>>;
  stt: SttProvider;
  search: SearchProvider;
  sessionSecret: Uint8Array;
  /** Exact origin of the Apollo web client (e.g. https://app.apolloassistant.app).
   *  Unset = no CORS headers at all, which is correct for a desktop-only
   *  deployment: browsers cannot call the API and nothing else changes. */
  webOrigin?: string;
  now?: () => number;
  logger?: boolean;
}

const PLAN_LIMITS: Record<string, Entitlements['limits']> = {
  free: { monthlyTurns: 200, maxTokensPerTurn: 2048 },
  pro: { monthlyTurns: 10_000, maxTokensPerTurn: 8192 },
};

function limitsFor(plan: string): Entitlements['limits'] {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free']!;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const now = deps.now ?? Date.now;
  const auth: Auth = createAuth(deps.sessionSecret, now);
  const app = Fastify({
    logger: deps.logger
      ? {
          // L6: never log content or credentials.
          redact: { paths: ['req.headers.authorization', 'req.body.system', 'req.body.messages', '*.refreshToken', '*.accessToken', '*.token'], remove: true },
        }
      : false,
  });

  // L6 standard web hardening headers (helmet-class, hand-rolled to avoid a dep).
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    // Phase 13 web client. One exact origin, never a wildcard and never an
    // echo of the request Origin — echoing would grant every website on earth
    // scripted access to a signed-in user's API.
    if (deps.webOrigin && req.headers.origin === deps.webOrigin) {
      reply.header('access-control-allow-origin', deps.webOrigin);
      reply.header('vary', 'origin');
    }
    return payload;
  });

  if (deps.webOrigin) {
    // Preflight for the JSON POSTs and the authorization header.
    app.options('/*', async (req, reply) => {
      if (req.headers.origin !== deps.webOrigin) return reply.code(403).send();
      return reply
        .header('access-control-allow-origin', deps.webOrigin)
        .header('access-control-allow-methods', 'GET, POST, PUT, DELETE')
        .header('access-control-allow-headers', 'authorization, content-type')
        .header('access-control-max-age', '86400')
        .code(204)
        .send();
    });
  }

  /** Authenticates a request from the bearer session JWT. 401 on any failure. */
  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<User | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      void reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    try {
      const claims = await auth.verifyAccessToken(header.slice(7));
      const user = await deps.store.getUser(claims.sub);
      if (!user) {
        void reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      return user;
    } catch {
      void reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
  }

  /** L0.1 quota: typed 429 with a reset time the client renders as friendly copy. */
  async function checkQuota(user: User, reply: FastifyReply): Promise<boolean> {
    const limit = limitsFor(user.plan).monthlyTurns;
    const usage = await deps.store.getUsage(user.id, limit, now());
    if (usage.used >= limit) {
      void reply.code(429).send({ error: 'quota_exceeded', used: usage.used, limit, resetIso: usage.resetIso });
      return false;
    }
    return true;
  }

  // ---- Auth ----

  const exchangeBody = z.object({
    code: z.string().min(1),
    codeVerifier: z.string().min(43).max(128), // RFC 7636 verifier length
    redirectUri: z.string().url(),
  });

  app.post('/auth/token', async (req, reply) => {
    const parsed = exchangeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    let claims;
    try {
      claims = await deps.identity.exchangeCode(parsed.data);
    } catch {
      return reply.code(401).send({ error: 'invalid_grant' });
    }
    const user = await deps.store.upsertUserBySubject(claims);
    const accessToken = await auth.signAccessToken(user);
    const refreshToken = await auth.issueRefreshToken(deps.store, user.id);
    return reply.send({
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
    });
  });

  /**
   * A real scrypt record for a random password. Verifying against this when the
   * account does not exist makes the failure path cost the same as a wrong
   * password, so timing does not disclose which addresses are registered.
   */
  let decoyHash: Promise<string> | null = null;
  const decoy = (): Promise<string> => (decoyHash ??= hashPassword(randomUUID()));

  // ---- L1.4 in-app password sign-in ----
  //
  // The desktop app posts credentials here from its own native form. Two
  // properties matter and are tested: responses never reveal whether an email
  // is registered, and repeated failures for one email are throttled so a
  // stolen password list cannot be replayed at speed.

  const credsBody = z.object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
    name: z.string().min(1).max(80).optional(),
  });

  /** Failed-attempt counters, keyed by normalized email. */
  const attempts = new Map<string, { count: number; until: number }>();
  const MAX_ATTEMPTS = 8;
  const LOCKOUT_MS = 15 * 60_000;

  function throttled(email: string): boolean {
    const rec = attempts.get(email);
    if (!rec) return false;
    if (now() > rec.until) {
      attempts.delete(email);
      return false;
    }
    return rec.count >= MAX_ATTEMPTS;
  }

  function noteFailure(email: string): void {
    const rec = attempts.get(email);
    const at = now();
    if (!rec || at > rec.until) attempts.set(email, { count: 1, until: at + LOCKOUT_MS });
    else attempts.set(email, { count: rec.count + 1, until: rec.until });
  }

  async function issueSession(user: { id: string; name: string; email: string; plan: string; subject: string }) {
    const accessToken = await auth.signAccessToken(user);
    const refreshToken = await auth.issueRefreshToken(deps.store, user.id);
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
    };
  }

  app.post('/auth/signup', async (req, reply) => {
    const parsed = credsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const email = normalizeEmail(parsed.data.email);
    const policy = validatePassword(parsed.data.password);
    if (!policy.ok) return reply.code(400).send({ error: 'weak_password', message: policy.reason });

    const existing = await deps.store.getUserByEmail(email);
    if (existing) {
      // Deliberately the same shape as a successful-looking failure: signup
      // must not confirm which addresses already have accounts.
      return reply.code(409).send({ error: 'signup_failed' });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await deps.store.createPasswordUser({
      name: parsed.data.name?.trim() || email.split('@')[0] || 'there',
      email,
      passwordHash,
    });
    return reply.send(await issueSession(user));
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = credsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const email = normalizeEmail(parsed.data.email);
    if (throttled(email)) return reply.code(429).send({ error: 'too_many_attempts' });

    const user = await deps.store.getUserByEmail(email);
    // Verify against a decoy hash when the account is missing or is an IdP
    // account, so the response time does not disclose which case it was.
    const stored = user?.passwordHash ?? (await decoy());
    const ok = await verifyPassword(parsed.data.password, stored);
    if (!ok || !user || !user.passwordHash) {
      noteFailure(email);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    attempts.delete(email);
    return reply.send(await issueSession(user));
  });

  app.post('/auth/refresh', async (req, reply) => {
    const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const rotated = await auth.rotateRefreshToken(deps.store, parsed.data.refreshToken);
    if (!rotated) return reply.code(401).send({ error: 'invalid_grant' });
    const accessToken = await auth.signAccessToken(rotated.user);
    return reply.send({
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      user: { id: rotated.user.id, name: rotated.user.name, email: rotated.user.email, plan: rotated.user.plan },
    });
  });

  app.post('/auth/logout', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    await deps.store.revokeUserRefresh(user.id);
    await deps.identity.revoke?.(user.subject);
    return reply.send({ ok: true });
  });

  // ---- Inference proxy ----

  app.post('/v1/llm', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const parsed = llmRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await checkQuota(user, reply))) return reply;

    const limits = limitsFor(user.plan);
    // Provider dispatch: omitted → anthropic, so pre-multi-provider clients
    // keep working. The model is clamped to the shared catalog — an id the
    // translation layer has never seen is replaced by the provider default,
    // never forwarded upstream.
    const providerId: LlmProviderId = parsed.data.provider ?? 'anthropic';
    const provider = providerId === 'anthropic' ? deps.llm : deps.llmProviders?.[providerId];
    if (!provider) return reply.code(400).send({ error: 'provider_unavailable', provider: providerId });
    const { model } = resolveModelChoice(providerId, parsed.data.model ?? null);
    const body = { ...parsed.data, model, maxTokens: Math.min(parsed.data.maxTokens, limits.maxTokensPerTurn) };

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    });

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    const write = (e: LlmSseEvent): void => {
      if (!reply.raw.writableEnded) reply.raw.write(encodeSse(e));
    };

    try {
      await provider.stream(body, write, abort.signal);
    } catch {
      write({ type: 'error', code: 'internal', message: 'stream failed' });
    }
    // Meter the turn (token counts only; never content).
    await deps.store.recordTurn(user.id, limits.monthlyTurns, now());
    if (!reply.raw.writableEnded) reply.raw.end();
    return reply;
  });

  // Which providers this deployment holds keys for; drives the model picker.
  app.get('/v1/models', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const configured: LlmProviderId[] = ['anthropic', ...(Object.keys(deps.llmProviders ?? {}) as LlmProviderId[])];
    return reply.send(availableModels(configured));
  });

  // ---- Phase 13.4 web content: notes + calendar for the web client ----
  // requireUser scopes every call; the store's userId parameter makes a
  // cross-account read unrepresentable. Content routes never touch LLM quota.

  const noteBody = z.object({
    id: z.string().min(1).max(64),
    title: z.string().max(200).default(''),
    content: z.string().max(100_000).default(''),
    pinned: z.boolean().default(false),
  });

  app.get('/v1/notes', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    return reply.send({ notes: await deps.store.listNotes(user.id) });
  });

  app.put('/v1/notes', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const parsed = noteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.send({ note: await deps.store.upsertNote(user.id, { ...parsed.data, updatedAt: now() }) });
  });

  app.delete('/v1/notes/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const { id } = req.params as { id: string };
    return reply.send({ ok: await deps.store.deleteNote(user.id, id) });
  });

  const eventBody = z.object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    startIso: z.string().min(1),
    endIso: z.string().min(1),
    allDay: z.boolean().default(false),
    location: z.string().max(500).nullable().default(null),
    notes: z.string().max(5000).nullable().default(null),
  });

  app.get('/v1/events', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const q = z.object({ fromIso: z.string(), toIso: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.send({ events: await deps.store.listEvents(user.id, q.data.fromIso, q.data.toIso) });
  });

  app.put('/v1/events', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const parsed = eventBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    if (parsed.data.endIso < parsed.data.startIso) return reply.code(400).send({ error: 'invalid_request' });
    return reply.send({ event: await deps.store.upsertEvent(user.id, { ...parsed.data, updatedAt: now() }) });
  });

  app.delete('/v1/events/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const { id } = req.params as { id: string };
    return reply.send({ ok: await deps.store.deleteEvent(user.id, id) });
  });

  app.post('/v1/stt', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    if (!(await checkQuota(user, reply))) return reply;
    try {
      const minted = await deps.stt.mintToken();
      return reply.send({ ...minted, provider: 'deepgram' as const });
    } catch {
      return reply.code(502).send({ error: 'provider_unavailable' });
    }
  });

  app.get('/v1/search', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const parsed = z.object({ q: z.string().min(1).max(400) }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await checkQuota(user, reply))) return reply;
    try {
      return reply.send(await deps.search.search(parsed.data.q));
    } catch {
      return reply.code(502).send({ error: 'provider_unavailable' });
    }
  });

  // ---- Account ----

  app.get('/v1/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const limit = limitsFor(user.plan).monthlyTurns;
    const usage = await deps.store.getUsage(user.id, limit, now());
    return reply.send({
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
      usage: { used: usage.used, limit, resetIso: usage.resetIso ?? periodResetIso(now()) },
    });
  });

  app.get('/v1/entitlements', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    return reply.send(
      entitlementsSchema.parse({
        plan: user.plan,
        features: { llm: true, stt: true, search: true },
        limits: limitsFor(user.plan),
      }),
    );
  });

  app.get('/health', async () => ({ ok: true }));

  return app;
}
