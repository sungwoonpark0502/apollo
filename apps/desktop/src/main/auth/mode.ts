/**
 * L0.2 operating-mode selection. Managed mode is the default for real users:
 * signed in, all inference through the Apollo backend, no provider keys on the
 * device, no Keys UI. BYOK is the developer/self-host escape hatch that keeps
 * the entire Phase 0-11 offline test story working with no backend and no
 * account. The adapter layer picks the transport behind existing interfaces, so
 * the orchestrator, tools, and voice code never learn which mode is active.
 */
export type AppMode = 'managed' | 'byok';

export interface ModeInputs {
  /** Build flag: APOLLO_ALLOW_BYOK=true ships/permits the BYOK escape hatch. */
  allowByok: boolean;
  /** True when a provider key exists locally (env or safeStorage) at dev time. */
  hasProviderKey: boolean;
}

/**
 * BYOK when the build allows it AND the developer actually supplied a key;
 * otherwise managed. A managed build with a stray key still stays managed, so
 * a normal user can never be silently dropped onto direct provider calls.
 */
export function resolveMode(inputs: ModeInputs): AppMode {
  return inputs.allowByok && inputs.hasProviderKey ? 'byok' : 'managed';
}

/** Reads the build flag from the environment (main process only). */
export function byokAllowedFromEnv(env: Record<string, string | undefined>): boolean {
  return env['APOLLO_ALLOW_BYOK'] === 'true' || env['APOLLO_ALLOW_BYOK'] === '1';
}
