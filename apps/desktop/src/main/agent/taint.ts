/**
 * C8.7 taint rule: while untrusted content has entered the conversation, any
 * Tier 3 argument of semantic type recipient/URL/path whose value was never
 * stated by the user gets flagged and rendered red in the ConfirmCard.
 */
const SENSITIVE_KEYS = new Set([
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'address', 'addresses',
  'url', 'uri', 'href', 'link',
  'path', 'dir', 'directory', 'file', 'filename', 'dest', 'destination',
]);

function stringValuesOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

export interface TaintOptions {
  /** Values the user is deemed to have authorized indirectly (e.g. saved contact emails). */
  knownValues?: string[];
  /** Keys checked even when conversation taint is false (e.g. email.send recipients, C13). */
  alwaysCheckKeys?: Set<string>;
  /** When false, only alwaysCheckKeys are evaluated (used for the untainted email.send path). */
  taint?: boolean;
}

export function computeTaintFlags(args: Record<string, unknown>, userUtterances: string[], opts: TaintOptions = {}): string[] {
  const taint = opts.taint ?? true;
  const flags: string[] = [];
  const utterances = userUtterances.map((u) => u.toLowerCase());
  const known = (opts.knownValues ?? []).map((k) => k.toLowerCase());
  for (const [key, value] of Object.entries(args)) {
    const lowerKey = key.toLowerCase();
    if (!SENSITIVE_KEYS.has(lowerKey)) continue;
    const alwaysCheck = opts.alwaysCheckKeys?.has(lowerKey) ?? false;
    if (!taint && !alwaysCheck) continue;
    for (const v of stringValuesOf(value)) {
      const needle = v.toLowerCase();
      const stated = utterances.some((u) => u.includes(needle));
      const resolved = known.includes(needle);
      if (!stated && !resolved) {
        flags.push(`value_not_user_stated:${key}`);
        break;
      }
    }
  }
  return flags;
}
