import { buildServer, type IdentityProvider } from './server';
import { createAnthropicProvider, createBraveProvider, createDeepgramProvider } from './lib/providers';
import { createOpenAiProvider } from './lib/providersOpenAi';
import { createGeminiProvider } from './lib/providersGoogle';
import { createMemoryStore } from './store/store';
import { createPostgresStore } from './store/postgres';

/**
 * Production entrypoint. Secrets come from the host secret manager via env and
 * are never committed. See HUMAN_TODO for deployment + identity-provider setup.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

/** Generic OIDC code exchange against the configured hosted provider (L1). */
function createOidcIdentity(): IdentityProvider {
  const tokenUrl = required('OIDC_TOKEN_URL');
  const userinfoUrl = required('OIDC_USERINFO_URL');
  const clientId = required('OIDC_CLIENT_ID');
  const clientSecret = process.env['OIDC_CLIENT_SECRET'];
  return {
    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      });
      const res = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) throw new Error('code exchange failed');
      const tokens = (await res.json()) as { access_token: string };
      const info = await fetch(userinfoUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (!info.ok) throw new Error('userinfo failed');
      const claims = (await info.json()) as { sub: string; name?: string; email?: string };
      return { subject: claims.sub, name: claims.name ?? 'Apollo user', email: claims.email ?? '' };
    },
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const store = databaseUrl ? await createPostgresStore(databaseUrl) : createMemoryStore();
  if (!databaseUrl) {
    console.warn('DATABASE_URL unset: using the in-memory store (development only)');
  }

  // Optional providers: configured only when their key is present, so a
  // deployment can be Anthropic-only and /v1/models reports the truth.
  const openaiKey = process.env['OPENAI_API_KEY'];
  const googleKey = process.env['GOOGLE_AI_API_KEY'];

  const app = buildServer({
    store,
    identity: createOidcIdentity(),
    llm: createAnthropicProvider(required('ANTHROPIC_API_KEY')),
    llmProviders: {
      ...(openaiKey ? { openai: createOpenAiProvider(openaiKey) } : {}),
      ...(googleKey ? { google: createGeminiProvider(googleKey) } : {}),
    },
    stt: createDeepgramProvider(required('DEEPGRAM_API_KEY'), required('DEEPGRAM_PROJECT_ID')),
    search: createBraveProvider(required('BRAVE_API_KEY')),
    sessionSecret: new TextEncoder().encode(required('SESSION_SECRET')),
    logger: true,
  });

  const port = Number(process.env['PORT'] ?? 8787);
  await app.listen({ port, host: '0.0.0.0' });
}

void main();
