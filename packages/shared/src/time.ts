/** All persisted timestamps are epoch milliseconds UTC. */
export type EpochMs = number;

export function nowMs(): EpochMs {
  return Date.now();
}

export const MS = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;
