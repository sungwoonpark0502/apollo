export interface GeoResult {
  label: string;
  city: string;
  lat: number;
  lon: number;
  tz: string;
  countryCode: string;
}

/**
 * E6/E7 geocoding autocomplete cache. Wraps a query→results fetcher with a
 * normalized-key cache so repeated/prefix-identical lookups don't re-hit the
 * network. Pure aside from the injected fetcher; unit-tested.
 */
export function createGeocodeCache(fetcher: (q: string, countryCode?: string) => Promise<GeoResult[]>) {
  const cache = new Map<string, GeoResult[]>();
  const keyOf = (q: string, cc?: string): string => `${(cc ?? '').toLowerCase()}|${q.trim().toLowerCase()}`;

  return {
    async search(query: string, countryCode?: string): Promise<GeoResult[]> {
      if (!query.trim()) return [];
      const key = keyOf(query, countryCode);
      const hit = cache.get(key);
      if (hit) return hit;
      const results = await fetcher(query, countryCode);
      cache.set(key, results);
      return results;
    },
    has(query: string, countryCode?: string): boolean {
      return cache.has(keyOf(query, countryCode));
    },
    size(): number {
      return cache.size;
    },
  };
}

export type GeocodeCache = ReturnType<typeof createGeocodeCache>;
