import { beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createSettingsRepo, type SettingsRepo } from '../db/repos/misc';
import { createSecrets, type SecretCodec } from './secrets';
import { createLoggerTo } from '../logger';

const xorCodec: SecretCodec = {
  available: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString('utf8'),
};

let db: Db;
let settings: SettingsRepo;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  settings = createSettingsRepo(db);
});

describe('secrets (C5/C14.2)', () => {
  it('stored settings take precedence over env', () => {
    const secrets = createSecrets({ settings, codec: xorCodec, env: { ANTHROPIC_API_KEY: 'env-key' } });
    expect(secrets.get('anthropic')).toBe('env-key');
    secrets.set('anthropic', 'stored-key');
    expect(secrets.get('anthropic')).toBe('stored-key');
  });

  it('never stores plaintext in the settings table', () => {
    const secrets = createSecrets({ settings, codec: xorCodec, env: {} });
    secrets.set('deepgram', 'dg-super-secret');
    const raw = settings.get('secret.deepgram');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('dg-super-secret');
  });

  it('refuses to store when encryption is unavailable', () => {
    const secrets = createSecrets({
      settings,
      codec: { ...xorCodec, available: () => false },
      env: {},
    });
    expect(secrets.set('brave', 'k')).toBe(false);
    expect(settings.get('secret.brave')).toBeNull();
  });

  it('wipeAll removes every stored secret', () => {
    const secrets = createSecrets({ settings, codec: xorCodec, env: {} });
    secrets.set('anthropic', 'a');
    secrets.set('brave', 'b');
    secrets.wipeAll();
    expect(secrets.get('anthropic')).toBeNull();
    expect(secrets.get('brave')).toBeNull();
  });

  it('H3 key metadata: info() exposes last4 + setAt but never the key; remove clears both', () => {
    const secrets = createSecrets({ settings, codec: xorCodec, env: {} });
    secrets.set('anthropic', 'sk-ant-abcd1234');
    const info = secrets.info();
    const a = info.find((i) => i.provider === 'anthropic')!;
    expect(a.configured).toBe(true);
    expect(a.last4).toBe('1234');
    expect(typeof a.setAt).toBe('number');
    // the metadata blob must not contain the full key
    expect(settings.get('keymeta.anthropic')).not.toContain('sk-ant-abcd1234');
    // untouched providers report not-configured
    expect(info.find((i) => i.provider === 'brave')!.configured).toBe(false);

    secrets.delete('anthropic');
    expect(secrets.info().find((i) => i.provider === 'anthropic')!.configured).toBe(false);
    expect(secrets.info().find((i) => i.provider === 'anthropic')!.last4).toBeNull();
  });
});

describe('log redaction (C14.2): keys never appear in logs', () => {
  function captureLogs(write: (log: ReturnType<typeof createLoggerTo>) => void): string {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += String(chunk);
        cb();
      },
    });
    const logger = createLoggerTo(sink);
    write(logger);
    logger.flush();
    return out;
  }

  it('redacts apiKey/token fields at any depth', () => {
    const out = captureLogs((log) => {
      log.info({ apiKey: 'sk-ant-SECRET1' }, 'top level');
      log.info({ provider: { api_key: 'SECRET2', token: 'SECRET3' } }, 'nested');
      log.info({ oauth: { access_token: 'SECRET4', refresh_token: 'SECRET5' } }, 'oauth');
      log.info({ headers: { authorization: 'Bearer SECRET6' } }, 'headers');
      log.info({ email: { body: 'PRIVATE-BODY', safeHtml: '<p>PRIVATE-HTML</p>' } }, 'email');
    });
    for (const secret of ['SECRET1', 'SECRET2', 'SECRET3', 'SECRET4', 'SECRET5', 'SECRET6', 'PRIVATE-BODY', 'PRIVATE-HTML']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[Redacted]');
  });
});
