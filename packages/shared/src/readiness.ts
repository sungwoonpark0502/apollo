/**
 * L5 readiness, fixed at the source. The old check asked "are local provider
 * keys present?" and produced the "add your Anthropic and Deepgram keys"
 * banner for every user. Readiness now depends on the operating mode:
 *
 *   managed → signed in (+ entitled). Never a keys message; the only affordance
 *             is a single friendly sign-in prompt.
 *   byok    → local keys, exactly as Phases 0-11 behaved.
 *
 * Shared so the Workspace banner, Chat composer, and Settings all agree.
 */
export type AppMode = 'managed' | 'byok';
export type AuthStatus = 'signedOut' | 'signingIn' | 'signedIn';

export interface ReadinessInputs {
  mode: AppMode;
  authStatus: AuthStatus;
  /** BYOK only: whether the local Anthropic key exists. */
  hasLlmKey: boolean;
  /** BYOK only: whether the local Deepgram key exists. */
  hasSttKey: boolean;
  /** Managed only: the plan has run out of turns for the period. */
  quotaExceeded?: boolean;
}

export type ReadinessState =
  /** Everything the assistant needs is available. */
  | { kind: 'ready' }
  /** Managed, signed out: show one sign-in affordance (never a keys request). */
  | { kind: 'signInRequired' }
  /** Managed, over quota: local features still work. */
  | { kind: 'quotaExceeded' }
  /** BYOK, missing local keys: the developer path keeps the keys message. */
  | { kind: 'keysRequired'; missing: Array<'llm' | 'stt'> };

export function assistantReadiness(input: ReadinessInputs): ReadinessState {
  if (input.mode === 'managed') {
    if (input.authStatus !== 'signedIn') return { kind: 'signInRequired' };
    if (input.quotaExceeded) return { kind: 'quotaExceeded' };
    return { kind: 'ready' };
  }
  const missing: Array<'llm' | 'stt'> = [];
  if (!input.hasLlmKey) missing.push('llm');
  if (!input.hasSttKey) missing.push('stt');
  return missing.length > 0 ? { kind: 'keysRequired', missing } : { kind: 'ready' };
}

/** L5: the Keys tab exists only in BYOK builds; Account only in managed. */
export function settingsTabsFor(mode: AppMode): string[] {
  const common = ['general', 'voice', 'assistant', 'calendars', 'accounts', 'privacy', 'about'];
  return mode === 'managed' ? ['account', 'profile', ...common] : ['profile', ...common, 'keys'];
}
