import { type KeyProvider } from '@apollo/shared';
import { type SettingsRepo } from '../db/repos/misc';

/**
 * C5/C14.2: the only module that touches secrets. Values are encrypted with
 * safeStorage and stored as ciphertext in the settings table. Renderers can
 * set/test keys, never read them. Precedence: stored settings > env.
 */
export interface SecretCodec {
  encrypt(plain: string): string; // returns storable string (base64 ciphertext)
  decrypt(stored: string): string;
  available(): boolean;
}

export interface SecretsDeps {
  settings: SettingsRepo;
  codec: SecretCodec;
  env: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

const ENV_NAMES: Record<KeyProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  brave: 'BRAVE_API_KEY',
  picovoice: 'PICOVOICE_ACCESS_KEY',
};

const STORE_PREFIX = 'secret.';

export function createSecrets(deps: SecretsDeps) {
  return {
    /** Main-process only. Never expose over IPC. */
    get(provider: KeyProvider): string | null {
      const stored = deps.settings.get(STORE_PREFIX + provider);
      if (stored) {
        try {
          return deps.codec.decrypt(stored);
        } catch {
          deps.log?.(`secrets: failed to decrypt stored key for ${provider}`);
        }
      }
      const env = deps.env[ENV_NAMES[provider]];
      return env && env.length > 0 ? env : null;
    },
    set(provider: KeyProvider, value: string): boolean {
      if (!deps.codec.available()) {
        deps.log?.('secrets: safeStorage unavailable; refusing to store key');
        return false;
      }
      deps.settings.set(STORE_PREFIX + provider, deps.codec.encrypt(value));
      return true;
    },
    has(provider: KeyProvider): boolean {
      return this.get(provider) !== null;
    },
    delete(provider: KeyProvider): void {
      deps.settings.delete(STORE_PREFIX + provider);
    },
    wipeAll(): void {
      for (const p of Object.keys(ENV_NAMES) as KeyProvider[]) deps.settings.delete(STORE_PREFIX + p);
    },
  };
}

export type Secrets = ReturnType<typeof createSecrets>;

/** Electron safeStorage codec (constructed in index.ts where electron is available). */
export function safeStorageCodec(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}): SecretCodec {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64')),
  };
}

/** keys.test (C4): cheapest authenticated call per provider. */
export function createKeyTester(deps: {
  secrets: Secrets;
  fetchFn?: typeof fetch;
  model?: string;
}) {
  const fetchFn = deps.fetchFn ?? fetch;
  return async (provider: KeyProvider): Promise<{ ok: boolean; message: string }> => {
    const key = deps.secrets.get(provider);
    if (!key) return { ok: false, message: 'No key stored.' };
    try {
      switch (provider) {
        case 'anthropic': {
          const res = await fetchFn('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: deps.model ?? 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) return { ok: true, message: 'Key works.' };
          return { ok: false, message: res.status === 401 ? 'Invalid key.' : `Provider returned ${res.status}.` };
        }
        case 'deepgram': {
          const res = await fetchFn('https://api.deepgram.com/v1/projects', {
            headers: { Authorization: `Token ${key}` },
            signal: AbortSignal.timeout(10_000),
          });
          return res.ok ? { ok: true, message: 'Key works.' } : { ok: false, message: res.status === 401 ? 'Invalid key.' : `Provider returned ${res.status}.` };
        }
        case 'brave': {
          const res = await fetchFn('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
            headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          return res.ok ? { ok: true, message: 'Key works.' } : { ok: false, message: res.status === 401 ? 'Invalid key.' : `Provider returned ${res.status}.` };
        }
        case 'picovoice': {
          // No cheap validation endpoint; checked at engine init. Accept non-empty.
          return { ok: true, message: 'Key stored. It is validated when the wake engine starts.' };
        }
      }
    } catch {
      return { ok: false, message: 'Could not reach the provider (offline?).' };
    }
  };
}
