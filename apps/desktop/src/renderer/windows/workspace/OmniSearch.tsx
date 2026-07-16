import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, STRINGS, type EventDTO, type RecallItem } from '@apollo/shared';

const DEBOUNCE_MS = 150;
const MAX_TOTAL = 10;

type Row =
  | { group: 'notes'; item: RecallItem }
  | { group: 'events'; item: EventDTO }
  | { group: 'facts'; item: RecallItem };

export interface OmniSearchProps {
  onClose: () => void;
  onNavigate: (target: { view: 'notes'; noteId: string } | { view: 'calendar'; dateIso: string }) => void;
}

/** G6 omnisearch: one input, results grouped Notes / Events / Facts, keyboard nav. */
export function OmniSearch({ onClose, onNavigate }: OmniSearchProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<RecallItem[]>([]);
  const [facts, setFacts] = useState<RecallItem[]>([]);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Array<{ id: string; title: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // I6 empty state: before typing, show recent notes as a jumping-off point.
    void window.apollo.call('notes.list', { limit: 5 }).then((ns) => setRecent(ns.map((n) => ({ id: n.id, title: n.title }))));
  }, []);

  const createNote = (): void => {
    const q = query.trim();
    void window.apollo.call('notes.save', { content: q }).then((n) => { onNavigate({ view: 'notes', noteId: n.id }); onClose(); });
  };

  useEffect(() => {
    const q = query.trim();
    const h = setTimeout(() => {
      if (q.length < 2) {
        setNotes([]);
        setFacts([]);
        setEvents([]);
        return;
      }
      void window.apollo.call('recall.query', { query: q, kinds: ['note'], limit: 4 }).then(setNotes);
      void window.apollo.call('recall.query', { query: q, kinds: ['fact'], limit: 4 }).then(setFacts);
      void window.apollo.call('events.search', { query: q }).then((e) => setEvents(e.slice(0, 4)));
    }, DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = [
      ...notes.map((item) => ({ group: 'notes' as const, item })),
      ...events.map((item) => ({ group: 'events' as const, item })),
      ...facts.map((item) => ({ group: 'facts' as const, item })),
    ];
    return r.slice(0, MAX_TOTAL);
  }, [notes, events, facts]);

  // Clamp the active index to the current result count rather than resetting via an effect.
  const activeIdx = rows.length === 0 ? 0 : Math.min(active, rows.length - 1);

  const activate = (row: Row): void => {
    if (row.group === 'notes') onNavigate({ view: 'notes', noteId: row.item.refId });
    else if (row.group === 'events') onNavigate({ view: 'calendar', dateIso: new Date(row.item.startTs).toISOString().slice(0, 10) });
    else void window.apollo.call('settings.open', {}); // facts → Privacy memory table
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { onClose(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { setActive(Math.min(rows.length - 1, activeIdx + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive(Math.max(0, activeIdx - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') { const row = rows[activeIdx]; if (row) activate(row); e.preventDefault(); }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '92vw', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={STRINGS.workspace.omni.placeholder}
          style={{ width: '100%', boxSizing: 'border-box', padding: 'var(--sp-4)', fontSize: 'var(--fs-title)', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', outline: 'none' }}
        />
        <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
          {query.trim().length < 2 && recent.length > 0 ? (
            <div>
              <div style={{ padding: 'var(--sp-2) var(--sp-4)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{STRINGS.workspace.omni.recent}</div>
              {recent.map((n) => (
                <button key={n.id} onClick={() => { onNavigate({ view: 'notes', noteId: n.id }); onClose(); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: 'var(--sp-2) var(--sp-4)', background: 'transparent', color: 'var(--text-1)', fontSize: 'var(--fs-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.title || STRINGS.workspace.notes.untitled}
                </button>
              ))}
            </div>
          ) : null}
          {query.trim().length >= 2 && rows.length === 0 ? (
            <div style={{ padding: 'var(--sp-4)' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)', marginBottom: 'var(--sp-2)' }}>{STRINGS.workspace.omni.empty}</div>
              <button onClick={createNote} style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--accent)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)' }}>
                {STRINGS.workspace.omni.createNote(query.trim())}
              </button>
            </div>
          ) : null}
          {renderGroup(STRINGS.workspace.omni.notes, rows, 'notes', activeIdx, rows, activate, setActive)}
          {renderGroup(STRINGS.workspace.omni.events, rows, 'events', activeIdx, rows, activate, setActive)}
          {renderGroup(STRINGS.workspace.omni.facts, rows, 'facts', activeIdx, rows, activate, setActive)}
        </div>
      </div>
    </div>
  );
}

function renderGroup(
  label: string,
  rows: Row[],
  group: Row['group'],
  active: number,
  allRows: Row[],
  activate: (r: Row) => void,
  setActive: (i: number) => void,
): React.JSX.Element | null {
  const groupRows = rows.filter((r) => r.group === group);
  if (groupRows.length === 0) return null;
  return (
    <div>
      <div style={{ padding: 'var(--sp-2) var(--sp-4)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      {groupRows.map((row) => {
        const idx = allRows.indexOf(row);
        const title = row.group === 'events' ? row.item.title : row.item.title;
        const sub = row.group === 'events' ? fmtDate(row.item.startTs, 'short', { tz: row.item.tz }) : row.item.snippet;
        return (
          <button
            key={`${row.group}-${row.group === 'events' ? row.item.id : row.item.chunkId}`}
            onMouseEnter={() => setActive(idx)}
            onClick={() => activate(row)}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: 'var(--sp-2) var(--sp-4)', background: idx === active ? 'var(--accent-soft)' : 'transparent' }}
          >
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
          </button>
        );
      })}
    </div>
  );
}
