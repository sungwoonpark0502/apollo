import { type InvokeChannelName } from '@apollo/shared';

/**
 * H3 IPC throttling: token bucket per channel per sender. Limits are code
 * constants (not settings). On breach the router drops + logs + surfaces THROTTLED.
 */
const PER_MINUTE: Partial<Record<InvokeChannelName, number>> = {
  'agent.userMessage': 20,
  // PART K chat verbs (K1)
  'chat.send': 20,
  'chat.regenerate': 10,
  'chat.editAndResend': 10,
  'capture.submit': 30,
  'keys.test': 10,
  // local mutation channels
  'data.mutate': 120,
  'notes.save': 120,
  'notes.delete': 120,
  'notes.pin': 120,
  'todos.add': 120,
  'todos.toggle': 120,
  'todos.delete': 120,
  'events.create': 120,
  'events.update': 120,
  'events.delete': 120,
};
const DEFAULT_PER_MINUTE = 300;
const WINDOW_MS = 60_000;

export function limitFor(channel: InvokeChannelName): number {
  return PER_MINUTE[channel] ?? DEFAULT_PER_MINUTE;
}

interface Bucket {
  tokens: number;
  last: number;
}

export interface Throttle {
  /** Consumes a token; returns true if allowed, false if the bucket is empty. */
  allow(channel: InvokeChannelName, senderKey: string): boolean;
}

export function createThrottle(now: () => number = Date.now): Throttle {
  const buckets = new Map<string, Bucket>();
  return {
    allow(channel, senderKey): boolean {
      const cap = limitFor(channel);
      const key = `${channel}::${senderKey}`;
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: cap, last: t };
        buckets.set(key, b);
      }
      // refill continuously at cap tokens per window
      const refill = ((t - b.last) / WINDOW_MS) * cap;
      b.tokens = Math.min(cap, b.tokens + refill);
      b.last = t;
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}
