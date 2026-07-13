export interface GeoResult {
  label: string;
  lat: number;
  lon: number;
  tz: string;
}

/**
 * E6/E7 geocoding autocomplete cache. Wraps a query→results fetcher with a
 * normalized-key cache so repeated/prefix-identical lookups don't re-hit the
 * network. Pure aside from the injected fetcher; unit-tested.
 */
export function createGeocodeCache(fetcher: (q: string) => Promise<GeoResult[]>) {
  const cache = new Map<string, GeoResult[]>();
  const norm = (q: string): string => q.trim().toLowerCase();

  return {
    async search(query: string): Promise<GeoResult[]> {
      const key = norm(query);
      if (!key) return [];
      const hit = cache.get(key);
      if (hit) return hit;
      const results = await fetcher(query);
      cache.set(key, results);
      return results;
    },
    has(query: string): boolean {
      return cache.has(norm(query));
    },
    size(): number {
      return cache.size;
    },
  };
}

export type GeocodeCache = ReturnType<typeof createGeocodeCache>;
