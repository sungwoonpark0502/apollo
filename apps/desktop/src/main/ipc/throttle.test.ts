import { describe, expect, it } from 'vitest';
import { createThrottle, limitFor } from './throttle';

describe('IPC throttle token bucket (H3)', () => {
  it('allows a burst up to the channel limit then drops', () => {
    const t = 0;
    const th = createThrottle(() => t);
    // keys.test = 10/min
    for (let i = 0; i < 10; i++) expect(th.allow('keys.test', 's1')).toBe(true);
    expect(th.allow('keys.test', 's1')).toBe(false);
  });

  it('refills over the window', () => {
    let t = 0;
    const th = createThrottle(() => t);
    for (let i = 0; i < 20; i++) th.allow('agent.userMessage', 's1'); // drain (20/min)
    expect(th.allow('agent.userMessage', 's1')).toBe(false);
    t += 6_000; // 1/10 of a minute → ~2 tokens back (20/min)
    expect(th.allow('agent.userMessage', 's1')).toBe(true);
    expect(th.allow('agent.userMessage', 's1')).toBe(true);
    expect(th.allow('agent.userMessage', 's1')).toBe(false);
  });

  it('isolates buckets per sender', () => {
    const t = 0;
    const th = createThrottle(() => t);
    for (let i = 0; i < 10; i++) th.allow('keys.test', 's1');
    expect(th.allow('keys.test', 's1')).toBe(false);
    expect(th.allow('keys.test', 's2')).toBe(true); // separate sender, fresh bucket
  });

  it('isolates buckets per channel', () => {
    const t = 0;
    const th = createThrottle(() => t);
    for (let i = 0; i < 10; i++) th.allow('keys.test', 's1');
    expect(th.allow('keys.test', 's1')).toBe(false);
    expect(th.allow('settings.get', 's1')).toBe(true); // different channel, default 300
  });

  it('limitFor reflects the H3 defaults', () => {
    expect(limitFor('agent.userMessage')).toBe(20);
    expect(limitFor('capture.submit')).toBe(30);
    expect(limitFor('keys.test')).toBe(10);
    expect(limitFor('data.mutate')).toBe(120);
    expect(limitFor('settings.get')).toBe(300);
  });
});
