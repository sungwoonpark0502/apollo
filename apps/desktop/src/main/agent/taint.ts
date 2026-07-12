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

export function computeTaintFlags(args: Record<string, unknown>, userUtterances: string[]): string[] {
  const flags: string[] = [];
  const utterances = userUtterances.map((u) => u.toLowerCase());
  for (const [key, value] of Object.entries(args)) {
    if (!SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    for (const v of stringValuesOf(value)) {
      const needle = v.toLowerCase();
      if (!utterances.some((u) => u.includes(needle))) {
        flags.push(`value_not_user_stated:${key}`);
        break;
      }
    }
  }
  return flags;
}
