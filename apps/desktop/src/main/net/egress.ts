/**
 * C14.9 egress allowlist. Every outbound request goes through isAllowedUrl;
 * any other host is rejected and logged by the caller.
 */
export const BASE_ALLOWED_HOSTS: readonly string[] = [
  'api.anthropic.com',
  'api.deepgram.com',
  'api.search.brave.com',
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'gmail.googleapis.com',
  'www.googleapis.com', // I7 Google Calendar API (calendar/v3)
  'oauth2.googleapis.com',
  'accounts.google.com',
  'speech.platform.bing.com',
];

export interface EgressPolicy {
  allowedHosts(): string[];
  isAllowedUrl(url: string): boolean;
}

/** extraHosts: hosts of user-added feeds plus the update feed host. */
export function createEgressPolicy(extraHosts: () => string[]): EgressPolicy {
  return {
    allowedHosts() {
      return [...BASE_ALLOWED_HOSTS, ...extraHosts()];
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
