import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryByCode, filterCountries } from './countries';

describe('country list + filter', () => {
  it('has unique, valid alpha-2 codes', () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  it('prefix matches rank before substring matches', () => {
    const r = filterCountries('uni');
    // "United ..." (prefix) before "... (substring 'uni')"
    expect(r[0]!.name.toLowerCase().startsWith('uni')).toBe(true);
  });

  it('filters case-insensitively and caps results', () => {
    expect(filterCountries('india')).toEqual([{ code: 'IN', name: 'India' }]);
    expect(filterCountries('a', 5).length).toBeLessThanOrEqual(5);
  });

  it('empty query returns the head of the list', () => {
    expect(filterCountries('').length).toBeGreaterThan(0);
  });

  it('countryByCode resolves case-insensitively', () => {
    expect(countryByCode('us')?.name).toBe('United States');
    expect(countryByCode('GB')?.name).toBe('United Kingdom');
    expect(countryByCode(null)).toBeUndefined();
  });
});
