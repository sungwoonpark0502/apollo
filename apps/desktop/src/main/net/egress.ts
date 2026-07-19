import type { AppMode } from '../auth/mode';

/**
 * C14.9 egress allowlist. Every outbound request goes through isAllowedUrl;
 * any other host is rejected and logged by the caller.
 *
 * L6 makes the list mode-aware. The allowlist is a statement about where this
 * build is *able* to talk, so a managed build must not retain the ability to
 * reach a provider directly — even though it has no key to authenticate with,
 * an allowlist entry is exactly the thing that would let a bug or an injected
 * URL try. Managed keeps only what it genuinely uses; BYOK keeps the original
 * Phase 0-11 list so the offline/self-host story is unchanged.
 */

/** Hosts every mode needs, regardless of where inference is proxied. */
const COMMON_HOSTS: readonly string[] = [
  'api.open-meteo.com', // keyless weather
  'geocoding-api.open-meteo.com',
  'gmail.googleapis.com', // the user's own Google connection, not an Apollo provider
  'www.googleapis.com', // I7 Google Calendar API (calendar/v3)
  'oauth2.googleapis.com',
  'accounts.google.com',
  'speech.platform.bing.com', // keyless edge TTS
];

/**
 * Providers a BYOK build calls directly with the developer's own keys. In
 * managed mode the backend holds these credentials and the client never
 * resolves these hosts at all.
 */
const DIRECT_PROVIDER_HOSTS: readonly string[] = ['api.anthropic.com', 'api.search.brave.com'];

/**
 * Deepgram stays in BOTH modes, and deliberately so: managed STT mints a
 * short-lived scoped token at the backend and then streams audio straight to
 * Deepgram, because proxying a live audio socket through the backend would add
 * a round trip to every utterance. The credential is managed; the transport is
 * direct.
 */
const STT_HOST = 'api.deepgram.com';

/** The Phase 0-11 list, unchanged, and what BYOK still gets. */
export const BASE_ALLOWED_HOSTS: readonly string[] = [...DIRECT_PROVIDER_HOSTS, STT_HOST, ...COMMON_HOSTS];

export interface EgressModeHosts {
  /** Backend origin (managed inference proxy). */
  backendBaseUrl: string;
  /** OIDC authorize endpoint; its host is the IdP. */
  oidcAuthorizeUrl: string;
}

/** Hosts allowed for a given mode, before user feeds are added. */
export function hostsForMode(mode: AppMode, cfg: EgressModeHosts): string[] {
  if (mode === 'byok') return [...BASE_ALLOWED_HOSTS];
  const managed = [hostOf(cfg.backendBaseUrl), hostOf(cfg.oidcAuthorizeUrl)].filter((h): h is string => h !== null);
  return [...managed, STT_HOST, ...COMMON_HOSTS];
}

export interface EgressPolicy {
  allowedHosts(): string[];
  isAllowedUrl(url: string): boolean;
}

export interface EgressPolicyOpts {
  /** Read live: signing out or a mode change must take effect without a restart. */
  mode?: () => AppMode;
  hosts?: EgressModeHosts;
}

/** extraHosts: hosts of user-added feeds plus the update feed host. */
export function createEgressPolicy(extraHosts: () => string[], opts: EgressPolicyOpts = {}): EgressPolicy {
  return {
    allowedHosts() {
      // With no mode wired (tests, tools that predate L6) the original list
      // applies, so existing behavior is never silently narrowed.
      const base = opts.mode && opts.hosts ? hostsForMode(opts.mode(), opts.hosts) : [...BASE_ALLOWED_HOSTS];
      return [...base, ...extraHosts()];
    },
    isAllowedUrl(url: string): boolean {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return false;
      }
      if (u.protocol !== 'https:') return false;
      return this.allowedHosts().includes(u.hostname);
    },
  };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
