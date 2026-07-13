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
  hotkey: z.string().default('Alt+Space'), // Option+Space on macOS, Alt+Space on Windows
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
  launchAtLogin: z.boolean().default(false),
  openWorkspaceOnLaunch: z.boolean().default(false), // E7 General tab
  workspaceBounds: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable()
    .default(null),
  onboarded: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type Profile = Settings['profile'];

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/** Folds pre-Part-E stored settings (top-level home/units) into profile. */
export function migrateLegacySettings(raw: unknown, localTz = 'local'): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const o = raw as Record<string, unknown> & {
    home?: { name: string; lat: number; lon: number } | null;
    units?: 'imperial' | 'metric';
    profile?: Record<string, unknown>;
  };
  if (o['profile'] !== undefined || (o['home'] === undefined && o['units'] === undefined)) return raw;
  const { home, units, ...rest } = o;
  return {
    ...rest,
    profile: {
      ...(home ? { homePlace: { label: home.name, lat: home.lat, lon: home.lon, tz: localTz } } : {}),
      ...(units ? { units } : {}),
    },
  };
}
