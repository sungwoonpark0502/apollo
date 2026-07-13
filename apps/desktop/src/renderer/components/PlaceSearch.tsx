import React, { useEffect, useMemo, useRef, useState } from 'react';
import { debounce } from '../lib/debounce';
import { createGeocodeCache, type GeoResult } from '../lib/geocode';

/**
 * E6/E7 home-location search box: debounced Open-Meteo geocoding autocomplete
 * (via the geocode.search IPC channel), top 5, arrow-key selectable, cached.
 */
export function PlaceSearch({
  value,
  onSelect,
  debounceMs = 300,
  placeholder = 'Search for a city…',
}: {
  value: GeoResult | null;
  onSelect: (place: GeoResult) => void;
  debounceMs?: number;
  placeholder?: string;
}): React.JSX.Element {
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const cache = useMemo(() => createGeocodeCache((q) => window.apollo.call('geocode.search', { query: q })), []);
  const search = useMemo(
    () =>
      debounce((q: string) => {
        void cache.search(q).then((r) => {
          setResults(r);
          setOpen(r.length > 0);
          setActive(0);
        });
      }, debounceMs),
    [cache, debounceMs],
  );

  const typingRef = useRef(false);
  useEffect(() => {
    if (!typingRef.current && value) setText(value.label);
  }, [value]);

  const onChange = (q: string): void => {
    typingRef.current = true;
    setText(q);
    if (q.trim()) search(q);
    else {
      setResults([]);
      setOpen(false);
    }
  };

  const choose = (r: GeoResult): void => {
    typingRef.current = false;
    setText(r.label);
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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        style={input}
      />
      {open ? (
        <ul style={dropdown}>
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lon}`}
              onMouseDown={() => choose(r)}
              onMouseEnter={() => setActive(i)}
              style={{ ...item, background: i === active ? 'var(--accent-soft)' : 'transparent' }}
            >
              {r.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const dropdown: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, margin: '2px 0 0', padding: 0, listStyle: 'none',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  boxShadow: 'var(--shadow-card)', zIndex: 50, maxHeight: 200, overflow: 'auto',
};
const item: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-body)', color: 'var(--text-1)', cursor: 'pointer',
};
