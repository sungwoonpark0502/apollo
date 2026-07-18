import { describe, expect, it, vi } from 'vitest';
import { IpcRejectedError, makeChannelHandler, makeTrustedUrlCheck, type RouterOpts } from './router';
import { createThrottle } from './throttle';

function opts(over: Partial<RouterOpts> = {}): RouterOpts {
  return {
    isTrustedUrl: makeTrustedUrlCheck('http://localhost:5173'),
    isDev: true,
    log: vi.fn(),
    ...over,
  };
}

describe('ipc router pipeline', () => {
  it('accepts a valid payload from a trusted frame and validates the response', async () => {
    const handler = vi.fn().mockResolvedValue({ turnId: 't1' });
    const pipeline = makeChannelHandler('agent.userMessage', handler, opts());
    const res = await pipeline('http://localhost:5173/windows/workspace/index.html', {
      text: 'hi',
      source: 'text',
      convId: 'c1',
    });
    expect(res).toEqual({ turnId: 't1' });
    expect(handler).toHaveBeenCalledWith({ text: 'hi', source: 'text', convId: 'c1' }, undefined);
  });

  it('drops a spoofed-frame message without calling the handler', async () => {
    const handler = vi.fn();
    const o = opts();
    const pipeline = makeChannelHandler('agent.userMessage', handler, o);
    await expect(pipeline('https://evil.example.com/', { text: 'hi', source: 'text', convId: 'c1' })).rejects.toThrow(
      IpcRejectedError,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(o.log).toHaveBeenCalledWith(expect.stringContaining('untrusted sender'));
  });

  it('drops a message with no frame url', async () => {
    const handler = vi.fn();
    const pipeline = makeChannelHandler('agent.cancel', handler, opts());
    await expect(pipeline(undefined, { turnId: 't' })).rejects.toThrow(IpcRejectedError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload and logs it', async () => {
    const handler = vi.fn();
    const o = opts();
    const pipeline = makeChannelHandler('agent.userMessage', handler, o);
    await expect(
      pipeline('http://localhost:5173/x', { text: 42, source: 'nope', convId: [] }),
    ).rejects.toThrow(IpcRejectedError);
    expect(handler).not.toHaveBeenCalled();
    expect(o.log).toHaveBeenCalledWith(expect.stringContaining('invalid payload'));
  });

  it('rejects a handler response that violates the response schema', async () => {
    const handler = vi.fn().mockResolvedValue({ nope: true });
    const pipeline = makeChannelHandler('agent.cancel', handler, opts());
    await expect(pipeline('file:///app/index.html', { turnId: 't' })).rejects.toThrow();
  });

  it('trusts packaged file:// urls and the dev server only', () => {
    const trusted = makeTrustedUrlCheck('http://localhost:5173');
    expect(trusted('file:///Applications/Apollo.app/x/index.html')).toBe(true);
    expect(trusted('http://localhost:5173/windows/orb/index.html')).toBe(true);
    expect(trusted('https://apollo.example.com/index.html')).toBe(false);
    expect(trusted('http://localhost:9999/index.html')).toBe(false);
  });

  it('throttles a channel after its per-minute limit and surfaces THROTTLED (H3)', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true, message: 'ok' });
    const o = opts({ throttle: createThrottle(() => 0) });
    const pipeline = makeChannelHandler('keys.test', handler as never, o);
    // keys.test = 10/min
    for (let i = 0; i < 10; i++) await pipeline('file:///app/x', { provider: 'anthropic' }, undefined, 's1');
    await expect(pipeline('file:///app/x', { provider: 'anthropic' }, undefined, 's1')).rejects.toMatchObject({ reason: 'throttled' });
    expect(o.log).toHaveBeenCalledWith(expect.stringContaining('throttled'));
    // a different sender is unaffected
    await expect(pipeline('file:///app/x', { provider: 'anthropic' }, undefined, 's2')).resolves.toBeDefined();
  });
});
