import { describe, expect, it, vi } from 'vitest';
import { createGeocodeCache, type GeoResult } from './geocode';

const columbus: GeoResult[] = [{ label: 'Columbus, Ohio', lat: 39.96, lon: -83, tz: 'America/New_York' }];

describe('geocode cache (E6/E7)', () => {
  it('caches by normalized query; identical lookups hit only once', async () => {
    const fetcher = vi.fn(async () => columbus);
    const gc = createGeocodeCache(fetcher);
    expect(await gc.search('Columbus')).toEqual(columbus);
    expect(await gc.search('  columbus ')).toEqual(columbus); // same normalized key
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(gc.size()).toBe(1);
  });

  it('empty/whitespace queries never hit the network', async () => {
    const fetcher = vi.fn(async () => columbus);
    const gc = createGeocodeCache(fetcher);
    expect(await gc.search('')).toEqual([]);
    expect(await gc.search('   ')).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('distinct queries are cached separately', async () => {
    const fetcher = vi.fn(async (q: string) => [{ label: q, lat: 0, lon: 0, tz: 'UTC' }]);
    const gc = createGeocodeCache(fetcher);
    await gc.search('paris');
    await gc.search('tokyo');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(gc.has('Paris')).toBe(true);
    expect(gc.has('berlin')).toBe(false);
  });
});
