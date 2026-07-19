import React, { useEffect, useState } from 'react';
import { deleteEvent, listEvents, saveEvent, type WebEventDto } from './api';
import { isoOf, monthGrid, monthLabel } from './webDate';

/**
 * Web calendar: month grid + day agenda + a small event editor, on the
 * account's server-side events. Month/year jump included from day one — the
 * desktop taught us month-only stepping makes distant dates unreachable.
 */
export function CalendarView(): React.JSX.Element {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [events, setEvents] = useState<WebEventDto[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(isoOf(today));
  const [editing, setEditing] = useState<WebEventDto | null>(null);

  // Bumping this counter re-runs the fetch effect after a mutation.
  const [refresh, setRefresh] = useState(0);
  const reload = (): void => setRefresh((n) => n + 1);

  useEffect(() => {
    const from = new Date(year, month - 1, -6).toISOString();
    const to = new Date(year, month, 7).toISOString();
    void listEvents(from, to).then(setEvents);
  }, [year, month, refresh]);

  const step = (d: number): void => {
    const next = new Date(year, month - 1 + d, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const cells = monthGrid(year, month, isoOf(new Date()));
  const byDay = (iso: string): WebEventDto[] => events.filter((e) => e.startIso.slice(0, 10) <= iso && e.endIso.slice(0, 10) >= iso);
  const dayEvents = byDay(selectedDay);

  const newEvent = (): void =>
    setEditing({
      id: crypto.randomUUID(),
      title: '',
      startIso: `${selectedDay}T09:00:00`,
      endIso: `${selectedDay}T10:00:00`,
      allDay: false,
      location: null,
      notes: null,
    });

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--sp-4)', minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <button onClick={() => step(-12)} style={navBtn} aria-label="Previous year">«</button>
          <button onClick={() => step(-1)} style={navBtn} aria-label="Previous month">‹</button>
          <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); setSelectedDay(isoOf(today)); }} style={navBtn}>
            Today
          </button>
          <button onClick={() => step(1)} style={navBtn} aria-label="Next month">›</button>
          <button onClick={() => step(12)} style={navBtn} aria-label="Next year">»</button>
          <span style={{ flex: 1 }} />
          <strong style={{ fontSize: 'var(--fs-title)' }}>{monthLabel(year, month)}</strong>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, flex: 1, minHeight: 0 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>{d}</div>
          ))}
          {cells.map((c) => {
            const has = byDay(c.iso).length;
            return (
              <button
                key={c.iso}
                onClick={() => setSelectedDay(c.iso)}
                style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', cursor: 'pointer',
                  background: c.iso === selectedDay ? 'var(--accent-soft)' : c.inMonth ? 'var(--surface)' : 'var(--bg)',
                  color: c.inMonth ? 'var(--text-1)' : 'var(--text-3)', padding: 4, minHeight: 52,
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', fontFamily: 'var(--font-sans)',
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--fs-caption)', width: 20, height: 20, lineHeight: '20px', textAlign: 'center',
                    borderRadius: '50%', background: c.isToday ? 'var(--accent)' : 'transparent', color: c.isToday ? '#fff' : undefined,
                  }}
                >
                  {c.day}
                </span>
                {has > 0 ? <span style={{ fontSize: 10, color: 'var(--accent)' }}>{'•'.repeat(Math.min(has, 3))}</span> : null}
              </button>
            );
          })}
        </div>
      </main>

      <aside style={{ width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)', padding: 'var(--sp-4)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <strong style={{ flex: 1 }}>{selectedDay}</strong>
          <button onClick={newEvent} style={navBtn}>New event</button>
        </div>
        {dayEvents.length === 0 ? <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>Nothing scheduled.</p> : null}
        {dayEvents.map((e) => (
          <button key={e.id} onClick={() => setEditing(e)} style={eventRow}>
            <span style={{ display: 'block', fontWeight: 500 }}>{e.title}</span>
            <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
              {e.allDay ? 'All day' : `${e.startIso.slice(11, 16)} – ${e.endIso.slice(11, 16)}`}
              {e.location ? ` · ${e.location}` : ''}
            </span>
          </button>
        ))}
      </aside>

      {editing ? (
        <EventEditor
          event={editing}
          onSave={(e) => {
            setEditing(null);
            void saveEvent(e).then(reload);
          }}
          onDelete={(id) => {
            setEditing(null);
            void deleteEvent(id).then(reload);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function EventEditor({ event, onSave, onDelete, onClose }: {
  event: WebEventDto;
  onSave: (e: WebEventDto) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(event);
  const valid = draft.title.trim().length > 0 && draft.endIso >= draft.startIso;
  return (
    <div role="dialog" aria-label="Edit event" style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialog}>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value.slice(0, 200) })} placeholder="Title" autoFocus style={field} />
        <label style={lbl}>
          <input type="checkbox" checked={draft.allDay} onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })} /> All day
        </label>
        {!draft.allDay ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input type="datetime-local" value={draft.startIso.slice(0, 16)} onChange={(e) => setDraft({ ...draft, startIso: e.target.value + ':00' })} style={field} aria-label="Starts" />
            <input type="datetime-local" value={draft.endIso.slice(0, 16)} onChange={(e) => setDraft({ ...draft, endIso: e.target.value + ':00' })} style={field} aria-label="Ends" />
          </div>
        ) : null}
        <input value={draft.location ?? ''} onChange={(e) => setDraft({ ...draft, location: e.target.value || null })} placeholder="Location (optional)" style={field} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <button onClick={() => onSave(draft)} disabled={!valid} style={{ ...primaryBtn, opacity: valid ? 1 : 0.5 }}>Save</button>
          <button onClick={onClose} style={navBtn}>Cancel</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => onDelete(draft.id)} style={{ ...navBtn, color: 'var(--danger)' }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-2)', cursor: 'pointer',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const eventRow: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--border)', cursor: 'pointer',
  background: 'var(--surface)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)', color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeContent: 'center', zIndex: 100,
};
const dialog: React.CSSProperties = {
  width: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--shadow-card)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
};
const field: React.CSSProperties = {
  width: '100%', padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const lbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-body)', color: 'var(--text-2)' };
const primaryBtn: React.CSSProperties = {
  border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
