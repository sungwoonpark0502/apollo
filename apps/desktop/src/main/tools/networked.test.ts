import { describe, expect, it, vi } from 'vitest';
import { createWeatherTools } from './weather';
import { createSearchWebTool } from './searchWeb';
import { createRegistry } from './registry';
import { makeCtx } from './registry.test';
import type { HttpClient } from '../net/httpClient';

const geoResponse = { results: [{ name: 'Columbus', latitude: 39.96, longitude: -83.0, admin1: 'Ohio' }] };
const forecastResponse = {
  current: { temperature_2m: 88.2, apparent_temperature: 92.1, weather_code: 0, wind_speed_10m: 6.4, precipitation_probability: 5 },
  daily: {
    time: ['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'],
    temperature_2m_max: [90, 91, 87, 85, 84],
    temperature_2m_min: [70, 71, 69, 66, 65],
    weather_code: [0, 2, 61, 3, 0],
    precipitation_probability_max: [0, 10, 60, 20, null],
  },
};

function stubHttp(handler: (url: string) => unknown): HttpClient {
  return {
    getJson: vi.fn(async (url: string) => handler(url)),
    getText: vi.fn(async () => ''),
    postJson: vi.fn(async () => ({})),
  };
}

describe('weather tools', () => {
  it('geocodes, maps WMO codes, returns weather card, and caches for 10 minutes', async () => {
    let clock = 1_000_000;
    const http = stubHttp((url) => (url.includes('geocoding') ? geoResponse : forecastResponse));
    const reg = createRegistry(createWeatherTools({ http, getHome: () => null, getUnits: () => 'imperial', now: () => clock }));

    const res = await reg.execute('weather.now', { place: 'columbus' }, makeCtx());
    expect(res.llmText).toContain('Columbus, Ohio');
    expect(res.llmText).toContain('88°F');
    expect(res.card).toMatchObject({ kind: 'weather', place: 'Columbus, Ohio', now: { condition: 'Clear' } });

    // second call within 10 min → geocode again (different entry point) but forecast served from cache
    const callsBefore = (http.getJson as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('forecast')).length;
    await reg.execute('weather.now', { place: 'columbus' }, makeCtx());
    const callsAfter = (http.getJson as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('forecast')).length;
    expect(callsAfter).toBe(callsBefore);

    // cache expires after 10 minutes
    clock += 11 * 60_000;
    await reg.execute('weather.now', { place: 'columbus' }, makeCtx());
    const callsExpired = (http.getJson as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('forecast')).length;
    expect(callsExpired).toBe(callsAfter + 1);
  });

  it('falls back to home location and errors helpfully without one', async () => {
    const http = stubHttp(() => forecastResponse);
    const reg = createRegistry(createWeatherTools({ http, getHome: () => null, getUnits: () => 'imperial' }));
    expect((await reg.execute('weather.now', {}, makeCtx())).llmText).toMatch(/^ERROR no place given/);

    const reg2 = createRegistry(
      createWeatherTools({ http, getHome: () => ({ name: 'Home', lat: 1, lon: 2 }), getUnits: () => 'imperial' }),
    );
    expect((await reg2.execute('weather.now', {}, makeCtx())).llmText).toContain('Home');
  });

  it('errors when the place cannot be geocoded', async () => {
    const http = stubHttp((url) => (url.includes('geocoding') ? { results: [] } : forecastResponse));
    const reg = createRegistry(createWeatherTools({ http, getHome: () => null, getUnits: () => 'imperial' }));
    expect((await reg.execute('weather.now', { place: 'xyzzyville' }, makeCtx())).llmText).toMatch(/^ERROR could not find/);
  });
});

describe('search.web', () => {
  it('returns ERROR KEY_MISSING guidance without a key (no dead end)', async () => {
    const reg = createRegistry([createSearchWebTool({ http: stubHttp(() => ({})), getBraveKey: () => null })]);
    const res = await reg.execute('search.web', { query: 'anything' }, makeCtx());
    expect(res.llmText).toContain('ERROR KEY_MISSING');
    expect(res.llmText).toContain('Settings > Keys');
  });

  it('returns top-5 untrusted results with a newsList card', async () => {
    const http = stubHttp(() => ({
      web: {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://site${i}.com/page`,
          description: `Desc ${i}`,
        })),
      },
    }));
    const reg = createRegistry([createSearchWebTool({ http, getBraveKey: () => 'bk' })]);
    const res = await reg.execute('search.web', { query: 'test' }, makeCtx());
    expect(res.untrusted).toBe(true);
    expect(res.llmText.split('\n')).toHaveLength(5);
    expect(res.card).toMatchObject({ kind: 'newsList' });
  });
});
