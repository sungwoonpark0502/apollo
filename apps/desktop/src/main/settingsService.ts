import { SettingsSchema, defaultSettings, migrateLegacySettings, type Settings } from '@apollo/shared';
import { type SettingsRepo } from './db/repos/misc';

const KEY = 'app.settings';

/** Typed settings persisted as one validated JSON blob in the settings table. */
export function createSettingsService(repo: SettingsRepo, opts: { onChange?: (s: Settings, prev: Settings) => void } = {}) {
  let cache: Settings | null = null;

  function load(): Settings {
    if (cache) return cache;
    const raw = repo.get(KEY);
    if (!raw) {
      cache = defaultSettings();
      return cache;
    }
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      cache = SettingsSchema.parse(migrateLegacySettings(JSON.parse(raw), localTz));
    } catch {
      cache = defaultSettings(); // corrupt settings never brick the app
    }
    return cache;
  }

  return {
    get: load,
    set(next: Settings): Settings {
      const parsed = SettingsSchema.parse(next);
      const prev = load();
      repo.set(KEY, JSON.stringify(parsed));
      cache = parsed;
      opts.onChange?.(parsed, prev);
      return parsed;
    },
    patch(p: Partial<Settings>): Settings {
      return this.set({ ...load(), ...p } as Settings);
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
