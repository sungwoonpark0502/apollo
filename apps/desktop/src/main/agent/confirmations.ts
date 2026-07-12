import { newId, type ConfirmAction } from '@apollo/shared';

/** C8.1 approve/deny lexicons: full-match, case-insensitive, trimmed. */
export const APPROVE_RE = /^(yes|yeah|yep|sure|ok(ay)?|do it|send it|go ahead|confirm|approved?)$/i;
export const DENY_RE = /^(no|nope|don'?t|cancel|stop|never mind|abort)$/i;

export function matchConfirmReply(text: string): 'approve' | 'deny' | null {
  const t = text.trim();
  if (APPROVE_RE.test(t)) return 'approve';
  if (DENY_RE.test(t)) return 'deny';
  return null;
}

export interface PendingConfirmation<S> {
  confirmationId: string;
  action: ConfirmAction;
  expiresAt: number;
  snapshot: S;
}

/**
 * Holds at most one pending confirmation (C8.8). Creating a new one
 * auto-resolves the old with reason 'superseded'; a TTL timer resolves with
 * 'expired'. take() is the only way to consume.
 */
export function createConfirmationStore<S>(opts: {
  ttlMs: number;
  now: () => number;
  onAutoResolve: (pending: PendingConfirmation<S>, reason: 'superseded' | 'expired') => void;
}) {
  let pending: PendingConfirmation<S> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    get(): PendingConfirmation<S> | null {
      return pending;
    },
    create(action: ConfirmAction, snapshot: S): PendingConfirmation<S> {
      if (pending) {
        const old = pending;
        pending = null;
        clearTimer();
        opts.onAutoResolve(old, 'superseded');
      }
      const p: PendingConfirmation<S> = {
        confirmationId: newId(),
        action,
        expiresAt: opts.now() + opts.ttlMs,
        snapshot,
      };
      pending = p;
      timer = setTimeout(() => {
        if (pending?.confirmationId === p.confirmationId) {
          pending = null;
          clearTimer();
          opts.onAutoResolve(p, 'expired');
        }
      }, opts.ttlMs);
      return p;
    },
    /** Consumes the pending confirmation if the id matches (null if stale/unknown). */
    take(confirmationId: string): PendingConfirmation<S> | null {
      if (!pending || pending.confirmationId !== confirmationId) return null;
      const p = pending;
      pending = null;
      clearTimer();
      return p;
    },
  };
}
