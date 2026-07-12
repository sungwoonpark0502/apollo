/**
 * C15 per-host circuit breaker: opens after 5 consecutive failures,
 * half-open probe after 30s; a successful probe closes it.
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;

interface HostState {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;
}

export function createBreaker(nowFn: () => number = Date.now) {
  const hosts = new Map<string, HostState>();

  function get(host: string): HostState {
    let s = hosts.get(host);
    if (!s) {
      s = { state: 'closed', consecutiveFailures: 0, openedAt: 0 };
      hosts.set(host, s);
    }
    return s;
  }

  return {
    /** True if a request to this host may proceed (moves open→half-open after 30s). */
    canRequest(host: string): boolean {
      const s = get(host);
      if (s.state === 'closed') return true;
      if (s.state === 'open') {
        if (nowFn() - s.openedAt >= OPEN_MS) {
          s.state = 'half-open';
          return true; // one probe allowed
        }
        return false;
      }
      return true; // half-open: allow the probe
    },
    recordSuccess(host: string): void {
      const s = get(host);
      s.state = 'closed';
      s.consecutiveFailures = 0;
    },
    recordFailure(host: string): void {
      const s = get(host);
      s.consecutiveFailures += 1;
      if (s.state === 'half-open' || s.consecutiveFailures >= FAILURE_THRESHOLD) {
        s.state = 'open';
        s.openedAt = nowFn();
      }
    },
    stateOf(host: string): BreakerState {
      return get(host).state;
    },
  };
}

export type Breaker = ReturnType<typeof createBreaker>;
