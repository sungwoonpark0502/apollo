import { z } from 'zod';

export const adapterModeSchema = z.enum(['auto', 'real', 'fake']); // auto = real when its key exists (C17)

export const feedSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  category: z.string(),
  enabled: z.boolean().default(true),
});
export type Feed = z.infer<typeof feedSchema>;

export const orbEdgeSchema = z.enum(['left', 'right', 'top', 'bottom']);

export const SettingsSchema = z.object({
  // PART K: the palette hotkey is gone. Legacy stored `hotkey` values are
  // silently stripped by zod on parse and never re-registered (K1).
  orb: z
    .object({
      edge: orbEdgeSchema.default('right'),
      // per-display fraction (0..1) along the docked edge, keyed by display id
      positions: z.record(z.string(), z.number().min(0).max(1)).default({}),
    })
    .default({}),
  wake: z
    .object({
      enabled: z.boolean().default(true),
      sensitivity: z.number().min(0).max(1).default(0.5),
    })
    .default({}),
  ptt: z.object({ enabled: z.boolean().default(true) }).default({}),
  tts: z.object({ voice: z.string().default('en-US-JennyNeural') }).default({}),
  // H1 voice device + playback + follow-up settings
  voice: z
    .object({
      inputDeviceId: z.string().nullable().default(null), // null = system default
      outputDeviceId: z.string().nullable().default(null),
      ttsRate: z.number().min(0.8).max(1.5).default(1.0),
      earconVolume: z.number().min(0).max(1).default(0.7),
      followupWindowSec: z.number().int().min(0).max(15).default(6), // 0 = off
      pauseWakeOnBattery: z.boolean().default(false),
      // PART K: PTT keeps a global binding of its own now that the palette
      // hotkey is gone (K1 "retained: PTT binding under voice").
      pttHotkey: z.string().default('Alt+Space'),
    })
    .default({}),
  // PART K: Chat tab behavior
  chat: z
    .object({
      sendOnEnter: z.boolean().default(true), // false = Cmd/Ctrl+Enter sends
      showToolActivity: z.boolean().default(true), // inline "Checking your calendar…" lines
      autoScroll: z.boolean().default(true),
    })
    .default({}),
  // PART K: Workspace launch behavior (absorbs the legacy top-level openWorkspaceOnLaunch)
  workspace: z
    .object({
      // L2: Today is the default landing view (supersedes K1's 'chat').
      defaultView: z.enum(['chat', 'today', 'calendar', 'notes']).default('today'),
      openOnLaunch: z.boolean().default(false),
    })
    .default({}),
  usage: z
    .object({
      warnDailyAnthropicTokens: z.number().int().nullable().default(null), // null = no warning
    })
    .default({}),
  backup: z.object({ autoWeekly: z.boolean().default(true) }).default({}),
  dnd: z
    .object({
      startHH: z.number().int().min(0).max(23).default(22),
      endHH: z.number().int().min(0).max(23).default(8),
    })
    .default({}),
  brief: z.object({ timeHHMM: z.string().regex(/^\d{2}:\d{2}$/).default('08:30') }).default({}),
  history: z.object({ enabled: z.boolean().default(true) }).default({}),
  approvedDirs: z.array(z.string()).default([]), // seeded with Documents/Desktop/Downloads at boot
  feeds: z.array(feedSchema).default([]),
  adapters: z
    .object({
      stt: adapterModeSchema.default('auto'),
      tts: adapterModeSchema.default('auto'),
      wake: adapterModeSchema.default('auto'),
      llm: adapterModeSchema.default('auto'),
      embedder: adapterModeSchema.default('auto'), // G1: real when model files exist, else fake
    })
    .default({}),
  anthropic: z.object({ model: z.string().default('claude-sonnet-4-6') }).default({}),
  // E1 user profile; replaces the pre-Part-E top-level home/units fields
  profile: z
    .object({
      name: z.string().max(60).default(''), // '' allowed; prompt falls back
      homePlace: z
        .object({ label: z.string(), lat: z.number(), lon: z.number(), tz: z.string() })
        .nullable()
        .default(null),
      units: z.enum(['imperial', 'metric']).default('imperial'),
      timeFormat: z.enum(['12h', '24h']).default('12h'),
      weekStart: z.enum(['monday', 'sunday']).default('sunday'),
    })
    .default({}),
  // F1 proactive engine + quick capture
  proactive: z
    .object({
      enabled: z.boolean().default(true),
      maxPerDay: z.number().int().min(0).max(20).default(6), // budget for low/normal only
      voiceOnNudges: z.boolean().default(false), // default OFF: chime + card only
      rules: z
        .record(
          z.string(),
          z.object({
            enabled: z.boolean(),
            params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
          }),
        )
        .default({}),
    })
    .default({}),
  quickCapture: z
    .object({
      hotkey: z.string().default('CommandOrControl+Shift+N'),
      defaultType: z.enum(['note', 'todo']).default('note'),
    })
    .default({}),
  memory: z
    .object({
      indexEnabled: z.boolean().default(true), // G7: Clear index disables until re-enabled
    })
    .default({}),
  // I1 locale override for Intl formatting (null = follow OS)
  locale: z
    .object({
      region: z.string().nullable().default(null), // BCP-47, e.g. "en-US"; drives Intl formatting
    })
    .default({}),
  // I1 local calendar collections for categorization/color
  calendars: z
    .object({
      active: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            color: z.string(), // hex from a fixed palette
            kind: z.enum(['local', 'google']),
            readOnly: z.boolean().default(false),
          }),
        )
        .default([{ id: 'default', name: 'Personal', color: '#D97757', kind: 'local', readOnly: false }]),
      defaultCalendarId: z.string().default('default'),
    })
    .default({}),
  // I7 Google Calendar sync (master opt-in; inert when disabled)
  googleCalendar: z
    .object({
      enabled: z.boolean().default(false),
      syncedCalendarIds: z.array(z.string()).default([]),
      direction: z.enum(['read-only', 'two-way']).default('read-only'),
      lastSyncTs: z.number().nullable().default(null),
    })
    .default({}),
  // I4 policy gate for the user-link egress lane
  allowLinkReading: z.boolean().default(true),
  // I6: one-time proactivity explainer has been shown
  firstNudgeSeen: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  workspaceBounds: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable()
    .default(null),
  onboarded: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type Profile = Settings['profile'];
export type CalendarCollection = Settings['calendars']['active'][number];

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/** Folds pre-Part-E stored settings (top-level home/units) into profile, and
 *  pre-Part-K stored settings (hotkey, openWorkspaceOnLaunch) into their new
 *  homes. The palette `hotkey` is dropped silently and never re-registered (K1). */
export function migrateLegacySettings(raw: unknown, localTz = 'local'): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let o = raw as Record<string, unknown> & {
    home?: { name: string; lat: number; lon: number } | null;
    units?: 'imperial' | 'metric';
    profile?: Record<string, unknown>;
    hotkey?: string;
    openWorkspaceOnLaunch?: boolean;
    workspace?: Record<string, unknown>;
  };
  if (o['profile'] === undefined && (o['home'] !== undefined || o['units'] !== undefined)) {
    const { home, units, ...rest } = o;
    o = {
      ...rest,
      profile: {
        ...(home ? { homePlace: { label: home.name, lat: home.lat, lon: home.lon, tz: localTz } } : {}),
        ...(units ? { units } : {}),
      },
    };
  }
  if (o['hotkey'] !== undefined || (o['openWorkspaceOnLaunch'] !== undefined && o['workspace'] === undefined)) {
    const { hotkey: _dropped, openWorkspaceOnLaunch, ...rest } = o;
    o = {
      ...rest,
      ...(openWorkspaceOnLaunch !== undefined ? { workspace: { openOnLaunch: openWorkspaceOnLaunch } } : {}),
    };
  }
  return o;
}
