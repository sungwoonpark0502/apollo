import React, { useMemo, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { debounce } from '../lib/debounce';
import { createGeocodeCache, type GeoResult } from '../lib/geocode';
import { COUNTRIES, filterCountries, type Country } from '../lib/countries';

/**
 * Two-step location picker (Country → City). The country field is a filtered
 * typeahead over the static ISO list; once a country is chosen, the city field
 * queries Open-Meteo geocoding restricted to that country and filters as you type.
 * Emits a GeoResult on city select; the caller stores it as the profile location.
 */
export function LocationPicker({ onSelect }: { onSelect: (place: GeoResult) => void }): React.JSX.Element {
  const p = STRINGS.settings.profile;
  const [country, setCountry] = useState<Country | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <CountryField
        value={country}
        onSelect={(c) => setCountry(c)}
        placeholder={p.countryPlaceholder}
      />
      <CityField
        country={country}
        onSelect={onSelect}
        placeholder={p.cityPlaceholder}
        disabledHint={p.cityPickCountryFirst}
        noMatches={p.cityNoMatches}
      />
    </div>
  );
}

function CountryField({ value, onSelect, placeholder }: { value: Country | null; onSelect: (c: Country) => void; placeholder: string }): React.JSX.Element {
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterCountries(text, 8), [text]);

  const choose = (c: Country): void => {
    setText(c.name);
    setOpen(false);
    onSelect(c);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(matches.length - 1, a + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') { const c = matches[active]; if (c) choose(c); e.preventDefault(); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        style={input}
      />
      {open && matches.length > 0 ? (
        <ul style={dropdown}>
          {matches.map((c, i) => (
            <li key={c.code} onMouseDown={() => choose(c)} onMouseEnter={() => setActive(i)} style={{ ...item, background: i === active ? 'var(--accent-soft)' : 'transparent' }}>
              {c.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CityField({ country, onSelect, placeholder, disabledHint, noMatches }: {
  country: Country | null;
  onSelect: (place: GeoResult) => void;
  placeholder: string;
  disabledHint: string;
  noMatches: string;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);

  const cache = useMemo(() => createGeocodeCache((q, cc) => window.apollo.call('geocode.search', { query: q, ...(cc ? { countryCode: cc } : {}) })), []);
  const search = useMemo(
    () =>
      debounce((q: string, cc: string) => {
        void cache
          .search(q, cc)
          .then((r) => {
            setResults(r);
            setFailed(false);
            setSearched(true);
            setOpen(true);
            setActive(0);
          })
          .catch(() => {
            // A lookup failure is not "no such city": say so, and invite a retry.
            setResults([]);
            setFailed(true);
            setSearched(true);
            setOpen(true);
          });
      }, 300),
    [cache],
  );

  const onChange = (q: string): void => {
    setText(q);
    setSearched(false);
    setFailed(false);
    if (q.trim() && country) search(q, country.code);
    else { setResults([]); setOpen(false); }
  };

  const choose = (r: GeoResult): void => {
    setText(r.city);
    setOpen(false);
    onSelect(r);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(results.length - 1, a + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') { const r = results[active]; if (r) choose(r); e.preventDefault(); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={text}
        disabled={!country}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={country ? placeholder : disabledHint}
        style={{ ...input, opacity: country ? 1 : 0.6, cursor: country ? 'text' : 'not-allowed' }}
      />
      {open ? (
        results.length > 0 ? (
          <ul style={dropdown}>
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lon}`} onMouseDown={() => choose(r)} onMouseEnter={() => setActive(i)} style={{ ...item, background: i === active ? 'var(--accent-soft)' : 'transparent' }}>
                {r.label}
              </li>
            ))}
          </ul>
        ) : searched && text.trim() ? (
          <ul style={dropdown}>
            <li style={{ ...item, color: failed ? 'var(--danger)' : 'var(--text-3)', cursor: 'default' }}>
              {failed ? STRINGS.settings.profile.locationLookupFailed : noMatches}
            </li>
          </ul>
        ) : null
      ) : null}
    </div>
  );
}

// Expose for a targeted count in case of empty static list regressions.
export const COUNTRY_COUNT = COUNTRIES.length;

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const dropdown: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, margin: '2px 0 0', padding: 0, listStyle: 'none',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  boxShadow: 'var(--shadow-card)', zIndex: 50, maxHeight: 220, overflow: 'auto',
};
const item: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-body)', color: 'var(--text-1)', cursor: 'pointer',
};
