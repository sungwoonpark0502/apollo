import { z } from 'zod';
import { MS, type ToolDef, type WeatherDay, type WeatherNow } from '@apollo/shared';
import { type HttpClient } from '../net/httpClient';

export interface WeatherToolDeps {
  http: HttpClient;
  /** E5: profile.homePlace is the default place. */
  getHome: () => { label: string; lat: number; lon: number; tz: string } | null;
  getUnits: () => 'imperial' | 'metric';
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

function condition(code: number): string {
  return WMO[code] ?? 'Unknown';
}

interface Geo { name: string; lat: number; lon: number }

interface CacheEntry { at: number; payload: { place: string; now: WeatherNow; days: WeatherDay[] } }

export function createWeatherTools(deps: WeatherToolDeps): ToolDef[] {
  const cache = new Map<string, CacheEntry>();
  const nowFn = deps.now ?? Date.now;

  async function geocode(place: string): Promise<Geo | null> {
    const data = (await deps.http.getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en`,
    )) as { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string }> };
    const r = data.results?.[0];
    return r ? { name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name, lat: r.latitude, lon: r.longitude } : null;
  }

  async function fetchWeather(place: string | undefined): Promise<{ place: string; now: WeatherNow; days: WeatherDay[] } | string> {
    let geo: Geo | null;
    if (place) {
      geo = await geocode(place);
      if (!geo) return `ERROR could not find a place called "${place}"`;
    } else {
      const home = deps.getHome();
      if (!home) return 'ERROR profile home location not set. Ask the user to set it in Settings > Profile.';
      geo = { name: home.label, lat: home.lat, lon: home.lon };
    }
    const units = deps.getUnits();
    const key = `${geo.lat.toFixed(3)},${geo.lon.toFixed(3)},${units}`;
    const hit = cache.get(key);
    if (hit && nowFn() - hit.at < 10 * MS.minute) return hit.payload;

    const unitParams =
      units === 'imperial'
        ? 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
        : 'wind_speed_unit=kmh';
    const data = (await deps.http.getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
        `&forecast_days=5&timezone=auto&${unitParams}`,
    )) as {
      current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; precipitation_probability: number | null };
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[]; precipitation_probability_max: Array<number | null> };
    };

    const payload = {
      place: geo.name,
      now: {
        tempF: Math.round(data.current.temperature_2m),
        feelsF: Math.round(data.current.apparent_temperature),
        condition: condition(data.current.weather_code),
        precipPct: Math.round(data.current.precipitation_probability ?? 0),
        windMph: Math.round(data.current.wind_speed_10m),
      },
      days: data.daily.time.slice(0, 5).map((dateIso, i) => ({
        dateIso,
        hiF: Math.round(data.daily.temperature_2m_max[i] ?? 0),
        loF: Math.round(data.daily.temperature_2m_min[i] ?? 0),
        condition: condition(data.daily.weather_code[i] ?? -1),
        precipPct: Math.round(data.daily.precipitation_probability_max[i] ?? 0),
      })),
    };
    cache.set(key, { at: nowFn(), payload });
    return payload;
  }

  const unitLabel = (): string => (deps.getUnits() === 'imperial' ? '°F' : '°C');

  const nowTool: ToolDef<z.ZodType<{ place?: string | undefined }>> = {
    name: 'weather.now',
    tier: 1,
    networked: true,
    description: 'Current weather. place is optional; defaults to the configured home location.',
    params: z.object({ place: z.string().optional() }),
    async execute(a) {
      const w = await fetchWeather(a.place);
      if (typeof w === 'string') return { llmText: w };
      return {
        llmText: `Weather in ${w.place}: ${w.now.tempF}${unitLabel()} (feels ${w.now.feelsF}), ${w.now.condition}, wind ${w.now.windMph}, precip ${w.now.precipPct}%.`,
        card: { kind: 'weather', place: w.place, now: w.now, days: w.days.slice(1) },
      };
    },
  };

  const forecast: ToolDef<z.ZodType<{ place?: string | undefined; days?: number | undefined }>> = {
    name: 'weather.forecast',
    tier: 1,
    networked: true,
    description: 'Multi-day forecast (default 4 days). place optional; defaults to home.',
    params: z.object({ place: z.string().optional(), days: z.number().int().min(1).max(5).optional() }),
    async execute(a) {
      const w = await fetchWeather(a.place);
      if (typeof w === 'string') return { llmText: w };
      const days = w.days.slice(0, a.days ?? 4);
      return {
        llmText:
          `Forecast for ${w.place}: ` +
          days.map((d) => `${d.dateIso}: ${d.condition}, ${d.hiF}/${d.loF}${unitLabel()}, precip ${d.precipPct}%`).join('; '),
        card: { kind: 'weather', place: w.place, now: w.now, days },
      };
    },
  };

  return [nowTool, forecast];
}
