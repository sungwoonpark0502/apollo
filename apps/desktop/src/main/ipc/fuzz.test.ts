import { describe, expect, it, vi } from 'vitest';
import { invokeChannels, type InvokeChannelName } from '@apollo/shared';
import { makeChannelHandler, IpcRejectedError, type Handlers } from './router';
import { createThrottle } from './throttle';

/**
 * J5.3 full IPC surface fuzz. Every invoke channel, fed malformed/oversized
 * payloads, must reject via zod (IpcRejectedError 'invalid_payload') without
 * throwing raw and without ever reaching the handler. Throttle buckets drop on
 * burst. Combined with registry-completeness.test.ts this is the security sweep
 * over the whole IPC surface.
 */
const CHANNELS = Object.keys(invokeChannels) as InvokeChannelName[];
const MALFORMED: unknown[] = [undefined, null, 42, 'a string', true, [], Symbol.for('x') as unknown];

const OPTS = { isTrustedUrl: () => true, isDev: false, log: () => {} };

function handlerFor<K extends InvokeChannelName>(name: K, onCall: () => void) {
  // A stub that must never run for malformed input.
  const stub = (() => { onCall(); return {} as unknown; }) as unknown as Handlers[K];
  return makeChannelHandler(name, stub, OPTS);
}

describe('J5.3 IPC fuzz — malformed payloads', () => {
  it('every channel rejects non-object / wrong-shape payloads with invalid_payload, handler never runs', async () => {
    for (const name of CHANNELS) {
      const onCall = vi.fn();
      const h = handlerFor(name, onCall);
      for (const bad of MALFORMED) {
        let err: unknown;
        try {
          await h('file:///app/index.html', bad, undefined, 's1');
        } catch (e) {
          err = e;
        }
        // Either zod rejected it (invalid_payload) — the required case for object schemas —
        // or the schema legitimately accepts it; in no case may the raw handler have thrown.
        if (err) {
          expect(err, `${name} <= ${String(bad)}`).toBeInstanceOf(IpcRejectedError);
          expect((err as IpcRejectedError).reason).toBe('invalid_payload');
        }
      }
      // At least the primitive garbage must be rejected (all req schemas are z.object).
      await expect(h('file:///app/index.html', 42, undefined, 's1')).rejects.toBeInstanceOf(IpcRejectedError);
      expect(onCall).not.toHaveBeenCalled();
    }
  });

  it('an oversized payload is handled without an unhandled throw', async () => {
    const onCall = vi.fn();
    const h = handlerFor('agent.userMessage', onCall);
    const huge = 'x'.repeat(5_000_000);
    // agent.userMessage requires specific fields; a giant wrong-shape object must reject cleanly.
    await expect(h('file:///app/index.html', { junk: huge }, undefined, 's1')).rejects.toBeInstanceOf(IpcRejectedError);
  });
});

describe('J5.3 IPC throttle drops on burst', () => {
  it('a burst beyond the per-minute cap is throttled', async () => {
    const throttle = createThrottle(() => 1_000); // frozen clock: no refill
    const onCall = vi.fn(() => ({ turnId: 't' }));
    const h = makeChannelHandler('agent.userMessage', onCall as unknown as Handlers['agent.userMessage'], {
      isTrustedUrl: () => true,
      isDev: false,
      log: () => {},
      throttle,
    });
    const good = { text: 'hi', source: 'text', convId: 'c1' };
    let throttled = 0;
    for (let i = 0; i < 40; i++) {
      try {
        await h('file:///app/index.html', good, undefined, 's1');
      } catch (e) {
        if (e instanceof IpcRejectedError && e.reason === 'throttled') throttled++;
      }
    }
    expect(throttled).toBeGreaterThan(0); // the bucket (20/min) drained → drops
  });
});
