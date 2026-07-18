import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  encodeSse,
  entitlementsSchema,
  llmRequestSchema,
  type Entitlements,
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
  llm: LlmProvider;
  stt: SttProvider;
  search: SearchProvider;
  sessionSecret: Uint8Array;
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
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    return payload;
  });

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
    const body = { ...parsed.data, maxTokens: Math.min(parsed.data.maxTokens, limits.maxTokensPerTurn) };

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
      await deps.llm.stream(body, write, abort.signal);
    } catch {
      write({ type: 'error', code: 'internal', message: 'stream failed' });
    }
    // Meter the turn (token counts only; never content).
    await deps.store.recordTurn(user.id, limits.monthlyTurns, now());
    if (!reply.raw.writableEnded) reply.raw.end();
    return reply;
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
