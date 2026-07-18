import { useCallback, useEffect, useState } from 'react';
import { configureCalendars, configureFormat, type DataChanged, type Settings } from '@apollo/shared';

/**
 * I2: keep format.ts's process-wide context in step with the user's locale,
 * time format, and week start. Call once at each window root; every fmt* call
 * then reads the fresh context, and format-consuming components re-render on
 * settings.changed because they read the settings blob too.
 */
export function useFormatInit(): void {
  useEffect(() => {
    const apply = (s: Settings): void => {
      configureFormat({
        locale: s.locale.region ?? navigator.language,
        timeFormat: s.profile.timeFormat,
        weekStart: s.profile.weekStart,
      });
      configureCalendars(s.calendars.active);
    };
    void window.apollo.call('settings.get', {}).then(apply);
    return window.apollo.on('settings.changed', apply);
  }, []);
}

/**
 * E2/E7 renderer live-sync helpers. useSettings tracks the live settings blob
 * (re-renders on settings.changed); useDataSync re-runs a loader whenever a
 * matching entity changes anywhere (voice, palette, or another Workspace pane).
 */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    void window.apollo.call('settings.get', {}).then((s) => {
      if (alive) setSettings(s);
    });
    const off = window.apollo.on('settings.changed', (s) => setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return settings;
}

/**
 * Runs `load` on mount and whenever a data.changed for one of `entities`
 * arrives. `load` and `entities` are read through the latest closure each time
 * a change fires, so callers may pass inline functions/arrays without churn.
 */
export function useDataSync<T>(
  entities: ReadonlyArray<DataChanged['entity']>,
  load: () => Promise<T>,
): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const key = entities.join(',');
  // A monotonically increasing tick forces reloads; the effect owns all reads.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = (): void => {
      void load().then((d) => {
        if (alive) setData(d);
      });
    };
    run();
    const wanted = new Set(entities);
    const off = window.apollo.on('data.changed', (c) => {
      if (wanted.has(c.entity)) run();
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  // Stable identity so callers can safely list `reload` in effect deps without
  // creating a render loop (setTick from useState is itself stable).
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, reload };
}

/** Subscribes to main → workspace navigation (deep links, app.open tool). */
export function useNavigate(onNavigate: (view: 'chat' | 'today' | 'calendar' | 'notes', dateIso?: string, noteId?: string, convId?: string) => void): void {
  useEffect(() => {
    const off = window.apollo.on('workspace.navigate', (n) => onNavigate(n.view, n.dateIso, n.noteId, n.convId));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
