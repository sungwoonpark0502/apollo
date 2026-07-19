import { DateTime } from 'luxon';
import { type CardPayload, type InvokeRes, type WeatherNow } from '@apollo/shared';
import { type HttpClient } from '../net/httpClient';

/**
 * E3.1 Today-view data that has no repo: the weather strip (home place, current
 * conditions + next 6 hours) and, since L2, today's news headlines. The
 * schedule comes straight from repos via events.list.
 */
export interface TodayDeps {
  http: HttpClient;
  getHome: () => { label: string; lat: number; lon: number; tz: string } | null;
  getUnits: () => 'imperial' | 'metric';
  getLatestBrief: () => CardPayload | null;
  /** L2: top headlines for the Today news section (feed items, no LLM). */
  getNews?: () => Promise<Array<{ title: string; source: string; url: string }>>;
  now?: () => number;
}

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
const condition = (code: number): string => WMO[code] ?? 'Unknown';

type TodayRes = InvokeRes<'workspace.today'>;

interface HourlyData {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  weather_code: number[];
}
interface Forecast {
  current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; precipitation: number; wind_speed_10m: number };
  hourly?: HourlyData;
}

export function createTodayProvider(deps: TodayDeps) {
  const nowFn = deps.now ?? Date.now;

  async function weather(): Promise<TodayRes['weather']> {
    const home = deps.getHome();
    if (!home) return null;
    const units = deps.getUnits();
    const unitParams =
      units === 'imperial'
        ? 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
        : 'wind_speed_unit=kmh';
    try {
      const data = (await deps.http.getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${home.lat}&longitude=${home.lon}` +
          `&current=temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m` +
          `&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=2&${unitParams}`,
      )) as Forecast;
      if (!data.current || !data.hourly) return null;
      const now: WeatherNow = {
        tempF: Math.round(data.current.temperature_2m),
        feelsF: Math.round(data.current.apparent_temperature),
        condition: condition(data.current.weather_code),
        precipPct: 0,
        windMph: Math.round(data.current.wind_speed_10m),
      };
      // next 6 hours from the current wall-clock hour in the home tz
      const nowIso = DateTime.fromMillis(nowFn(), { zone: home.tz === 'local' ? undefined : home.tz });
      const startHour = nowIso.startOf('hour');
      const hours: NonNullable<TodayRes['weather']>['hours'] = [];
      for (let i = 0; i < data.hourly.time.length && hours.length < 6; i++) {
        const t = DateTime.fromISO(data.hourly.time[i] as string, { zone: home.tz === 'local' ? undefined : home.tz });
        if (t < startHour) continue;
        hours.push({
          iso: data.hourly.time[i] as string,
          temp: Math.round(data.hourly.temperature_2m[i] as number),
          precipPct: data.hourly.precipitation_probability[i] ?? 0,
          condition: condition(data.hourly.weather_code[i] as number),
        });
      }
      now.precipPct = hours[0]?.precipPct ?? 0;
      return { place: home.label, now, hours };
    } catch {
      return null; // offline / provider hiccup: Today just omits weather
    }
  }

  return {
    async get(): Promise<TodayRes> {
      // Weather and news are independent: one failing must not blank the other.
      const [w, news] = await Promise.all([
        weather().catch(() => null),
        (deps.getNews?.() ?? Promise.resolve([])).catch(() => []),
      ]);
      return { weather: w, brief: deps.getLatestBrief(), news };
    },
  };
}

export type TodayProvider = ReturnType<typeof createTodayProvider>;
