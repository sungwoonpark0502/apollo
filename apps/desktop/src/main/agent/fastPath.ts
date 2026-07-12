/**
 * C9 fast path: runs before the LLM. The pattern must consume the entire
 * normalized utterance; any residue routes to the LLM. Target <100ms.
 */
export type FastPathIntent =
  | { kind: 'timer'; seconds: number }
  | { kind: 'timeNow' }
  | { kind: 'dateToday' }
  | { kind: 'openApp'; app: string }
  | { kind: 'volume'; op: 'up' | 'down' | 'set'; value?: number }
  | { kind: 'mute'; on: boolean }
  | { kind: 'stopTalking' }
  | { kind: 'media'; op: 'playpause' | 'next' | 'prev' };

export function normalizeUtterance(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^hey apollo[,!.]?\s*/, '')
    .replace(/[,!.]?\s*please[.!]?$/, '')
    .replace(/[.!?]$/, '');
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1, seconds: 1, sec: 1, secs: 1, s: 1,
  minute: 60, minutes: 60, min: 60, mins: 60, m: 60,
  hour: 3600, hours: 3600, hr: 3600, hrs: 3600, h: 3600,
};

export function matchFastPath(text: string): FastPathIntent | null {
  const t = normalizeUtterance(text);

  // timer: "set a timer for 5 minutes", "5 minute timer", "timer 30 seconds"
  {
    const m =
      t.match(/^(?:set )?(?:a )?timer(?: for)? (\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)$/) ??
      t.match(/^(?:set )?(?:a )?(\d+) ?(second|sec|minute|min|hour|hr) timer$/);
    if (m) {
      const n = parseInt(m[1] as string, 10);
      const mult = UNIT_SECONDS[m[2] as string];
      if (n > 0 && mult) return { kind: 'timer', seconds: n * mult };
    }
  }

  if (/^what time is it(?: now)?$/.test(t) || /^what'?s the time$/.test(t)) return { kind: 'timeNow' };

  if (/^what(?:'?s| is) (?:today'?s date|the date(?: today)?)$/.test(t) || /^what day is (?:it|today)$/.test(t)) {
    return { kind: 'dateToday' };
  }

  {
    const m = t.match(/^(?:open|launch) (.+)$/);
    if (m) return { kind: 'openApp', app: (m[1] as string).trim() };
  }

  {
    const m = t.match(/^(?:turn )?(?:the )?volume (up|down)$/);
    if (m) return { kind: 'volume', op: m[1] as 'up' | 'down' };
    const s = t.match(/^(?:set )?(?:the )?volume(?: to)? (\d{1,3})(?: percent| %)?$/);
    if (s) {
      const v = parseInt(s[1] as string, 10);
      if (v <= 100) return { kind: 'volume', op: 'set', value: v };
    }
  }

  {
    const m = t.match(/^(un)?mute(?: (?:yourself|the mic|your mic|mic|microphone))?$/);
    if (m) return { kind: 'mute', on: !m[1] };
  }

  if (/^(?:stop|quiet|shush|shut up|stop talking|be quiet|silence)$/.test(t)) return { kind: 'stopTalking' };

  {
    const m = t.match(/^(pause|play|resume|next|skip|previous|prev)(?: (?:song|track|music|the music))?$/);
    if (m) {
      const w = m[1] as string;
      if (w === 'next' || w === 'skip') return { kind: 'media', op: 'next' };
      if (w === 'previous' || w === 'prev') return { kind: 'media', op: 'prev' };
      return { kind: 'media', op: 'playpause' };
    }
  }

  return null;
}
