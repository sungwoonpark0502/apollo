import { describe, expect, it, vi } from 'vitest';
import { audioSessionAllows, defaultSessionAllows, lockDownSession } from './permissions';

describe('permission lockdown (H3)', () => {
  it('the default session denies every permission', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'midi', 'hid', 'display-capture', 'clipboard-read']) {
      expect(defaultSessionAllows(p)).toBe(false);
    }
  });

  it('the audio session allows only media', () => {
    expect(audioSessionAllows('media')).toBe(true);
    for (const p of ['geolocation', 'notifications', 'midi', 'hid', 'display-capture']) {
      expect(audioSessionAllows(p)).toBe(false);
    }
  });

  it('lockDownSession wires request + check + device handlers to the decision fn', () => {
    const handlers: Record<string, unknown> = {};
    const session = {
      setPermissionRequestHandler: (fn: unknown) => { handlers.request = fn; },
      setPermissionCheckHandler: (fn: unknown) => { handlers.check = fn; },
      setDevicePermissionHandler: (fn: unknown) => { handlers.device = fn; },
    } as never;
    const log = vi.fn();
    lockDownSession(session, defaultSessionAllows, log);

    // a scripted permission request from a renderer is rejected
    const cb = vi.fn();
    (handlers.request as (wc: unknown, p: string, cb: (b: boolean) => void) => void)(null, 'media', cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('media'));

    expect((handlers.check as (wc: unknown, p: string) => boolean)(null, 'geolocation')).toBe(false);
    expect((handlers.device as () => boolean)()).toBe(false);
  });

  it('audio session request handler allows media through', () => {
    const handlers: Record<string, unknown> = {};
    const session = {
      setPermissionRequestHandler: (fn: unknown) => { handlers.request = fn; },
      setPermissionCheckHandler: () => undefined,
      setDevicePermissionHandler: () => undefined,
    } as never;
    lockDownSession(session, audioSessionAllows);
    const cb = vi.fn();
    (handlers.request as (wc: unknown, p: string, cb: (b: boolean) => void) => void)(null, 'media', cb);
    expect(cb).toHaveBeenCalledWith(true);
  });
});
