import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * C5: zod-validated frozen config from the environment (a `.env` at the repo
 * root is parsed in dev). Secrets themselves live in security/secrets.ts;
 * this only surfaces which env vars exist plus non-secret settings.
 */
const ConfigSchema = z.object({
  anthropicModel: z.string().default('claude-sonnet-4-6'),
  env: z.record(z.string()),
});

export type AppConfig = Readonly<z.infer<typeof ConfigSchema>>;

export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = (m[2] as string).replace(/^["']|["']$/g, '');
    if (value) out[m[1] as string] = value;
  }
  return out;
}

export function loadConfig(opts: { dotEnvPath?: string; processEnv?: NodeJS.ProcessEnv } = {}): AppConfig {
  const processEnv = opts.processEnv ?? process.env;
  let fileEnv: Record<string, string> = {};
  if (opts.dotEnvPath) {
    try {
      fileEnv = parseDotEnv(readFileSync(opts.dotEnvPath, 'utf8'));
    } catch {
      // no .env is fine
    }
  }
  const env: Record<string, string> = { ...fileEnv };
  for (const [k, v] of Object.entries(processEnv)) if (typeof v === 'string' && v) env[k] = v;

  return Object.freeze(
    ConfigSchema.parse({
      anthropicModel: env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6',
      env,
    }),
  );
}
