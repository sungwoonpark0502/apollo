import { describe, expect, it } from 'vitest';
import { invokeChannels, pushChannels, type InvokeChannelName, type PushChannelName } from './ipc';
import { defaultSettings } from './settings';
import type { AgentEvent } from './agent';

/** A valid request+response fixture for every invoke channel. Adding a channel without a fixture fails the suite. */
const invokeFixtures: Record<InvokeChannelName, { req: unknown; res: unknown }> = {
  'agent.userMessage': {
    req: { text: 'set a timer for 5 minutes', source: 'text', convId: 'c1' },
    res: { turnId: 't1' },
  },
  'agent.cancel': { req: { turnId: 't1' }, res: { ok: true } },
  'agent.confirm': { req: { confirmationId: 'cf1', approved: true }, res: { ok: true } },
  'voice.setMuted': { req: { muted: true }, res: { ok: true } },
  'data.mutate': { req: { op: 'snoozeReminder', id: 'r1', min: 10 }, res: { ok: true } },
  'settings.get': { req: {}, res: defaultSettings() },
  'settings.set': { req: defaultSettings(), res: { ok: true } },
  'keys.set': { req: { provider: 'anthropic', value: 'sk-test' }, res: { ok: true } },
  'keys.test': { req: { provider: 'deepgram' }, res: { ok: false, message: 'no key stored' } },
  'oauth.google.start': { req: {}, res: { ok: true, address: 'user@gmail.com' } },
  'oauth.google.revoke': { req: {}, res: { ok: true } },
  'onboarding.finish': { req: {}, res: { ok: true } },
  'permissions.request': { req: { kind: 'mic' }, res: { granted: true } },
  'privacy.get': {
    req: {},
    res: { egressHosts: ['api.anthropic.com'], memoryFacts: [{ id: 'm1', category: 'person', fact: 'x' }] },
  },
  'privacy.deleteMemory': { req: { id: 'm1' }, res: { ok: true } },
  'privacy.wipe': { req: { confirm: 'ERASE' }, res: { ok: true } },
  'diagnostics.get': {
    req: {},
    res: {
      perf: [{ name: 'turn_total', count: 3, p50: 120, p95: 480 }],
      adapters: { stt: 'fake', tts: 'real', wake: 'fake', llm: 'real' },
      logTail: ['line one', 'line two'],
    },
  },
  'tts.drained': { req: {}, res: { ok: true } },
  'debug.wake': { req: {}, res: { ok: true } },
  'debug.injectAudio': { req: { wavPath: '/tmp/fixture.wav' }, res: { ok: true } },
};

const pushFixtures: Record<PushChannelName, unknown> = {
  'agent.events': { type: 'turnStart', turnId: 't1' } satisfies AgentEvent,
  'voice.state': { state: 'listening' },
  'voice.partial': { transcript: 'set a tim', rms: 0.42 },
  'tts.audio': { seq: 0, mime: 'audio/mp3', data: new ArrayBuffer(8), last: false },
  'tts.stop': {},
};

describe('invoke channel round-trips', () => {
  for (const [name, def] of Object.entries(invokeChannels)) {
    it(`${name} req+res round-trip`, () => {
      const fx = invokeFixtures[name as InvokeChannelName];
      expect(fx, `missing fixture for channel ${name}`).toBeDefined();
      expect(def.req.parse(fx.req)).toEqual(fx.req);
      expect(def.res.parse(fx.res)).toEqual(fx.res);
    });
  }
});

describe('push channel round-trips', () => {
  for (const [name, schema] of Object.entries(pushChannels)) {
    it(`${name} round-trip`, () => {
      const fx = pushFixtures[name as PushChannelName];
      expect(fx, `missing fixture for channel ${name}`).toBeDefined();
      expect(schema.parse(fx)).toEqual(fx);
    });
  }
});

describe('malformed payload rejection', () => {
  it('rejects wrong types', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: 5, source: 'text', convId: 'c' }).success).toBe(false);
  });
  it('rejects empty text', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: '', source: 'text', convId: 'c' }).success).toBe(false);
  });
  it('rejects unknown enum values', () => {
    expect(invokeChannels['agent.userMessage'].req.safeParse({ text: 'x', source: 'carrier-pigeon', convId: 'c' }).success).toBe(false);
    expect(invokeChannels['keys.set'].req.safeParse({ provider: 'openai', value: 'k' }).success).toBe(false);
  });
  it('rejects missing discriminant fields', () => {
    expect(invokeChannels['data.mutate'].req.safeParse({ id: 'x' }).success).toBe(false);
    expect(invokeChannels['data.mutate'].req.safeParse({ op: 'snoozeReminder', id: 'x', min: -5 }).success).toBe(false);
  });
  it('rejects garbage on push schemas', () => {
    expect(pushChannels['voice.state'].safeParse({ state: 'happy' }).success).toBe(false);
    expect(pushChannels['tts.audio'].safeParse({ seq: 0, mime: 'audio/wav', data: new ArrayBuffer(1), last: false }).success).toBe(false);
  });
});
