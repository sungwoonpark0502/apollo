import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { calendarColor, fmtDate, fmtDateIso, fmtRelative, fmtTime, STRINGS, type OccurrenceDTO, type Settings } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { monthGrid, weekdayHeaders } from '../../lib/calendarLayout';
import { EventEditorModal, type EditorInitial, type EditorResult } from './EventEditorModal';
import { ScopeDialog } from './ScopeDialog';
import { WeekView } from './WeekView';
import { AgendaView } from './AgendaView';

type SubTab = 'month' | 'week' | 'agenda';

export function CalendarView({ settings, initialDateIso }: { settings: Settings | null; initialDateIso?: string }): React.JSX.Element {
  const [sub, setSub] = useState<SubTab>('month');
  const [anchor, setAnchor] = useState(() => DateTime.fromISO(initialDateIso ?? DateTime.now().toISODate() ?? ''));
  const c = STRINGS.workspace.calendar;
  const weekStart = settings?.profile.weekStart ?? 'sunday';
  const localTz = DateTime.now().zoneName ?? 'local';

  const step = (delta: number): void => {
    setAnchor((a) => (sub === 'month' ? a.plus({ months: delta }) : sub === 'week' ? a.plus({ weeks: delta }) : a.plus({ days: delta * 30 })));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          {(['month', 'week', 'agenda'] as SubTab[]).map((t) => (
            <button key={t} onClick={() => setSub(t)} style={tabBtn(sub === t)}>
              {c[t]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => step(-1)} style={navBtn} aria-label={c.prev}>‹</button>
        <button onClick={() => setAnchor(DateTime.now())} style={navBtn}>{c.today}</button>
        <button onClick={() => step(1)} style={navBtn} aria-label={c.next}>›</button>
        <GcalIndicator enabled={!!settings?.googleCalendar.enabled} />
        <div style={{ minWidth: 160, textAlign: 'right', fontSize: 'var(--fs-title)', fontWeight: 600 }}>
          {fmtDate(anchor.toMillis(), 'month-year')}
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {sub === 'month' ? (
          <MonthView anchor={anchor} weekStart={weekStart} localTz={localTz} onNavigateWeek={(iso) => { setAnchor(DateTime.fromISO(iso)); setSub('week'); }} />
        ) : sub === 'week' ? (
          <WeekView anchor={anchor} localTz={localTz} />
        ) : (
          <AgendaView anchor={anchor} localTz={localTz} />
        )}
      </div>
    </div>
  );
}

function MonthView({
  anchor,
  weekStart,
  localTz,
  onNavigateWeek,
}: {
  anchor: DateTime;
  weekStart: 'monday' | 'sunday';
  localTz: string;
  onNavigateWeek: (iso: string) => void;
}): React.JSX.Element {
  const c = STRINGS.workspace.calendar;
  const todayIso = DateTime.now().toISODate() ?? '';
  const cells = useMemo(() => monthGrid(anchor.toISODate() ?? '', weekStart, todayIso), [anchor, weekStart, todayIso]);
  const headers = weekdayHeaders(weekStart);

  const rangeStart = DateTime.fromISO(cells[0]!.dateIso).startOf('day').toMillis();
  const rangeEnd = DateTime.fromISO(cells[41]!.dateIso).endOf('day').toMillis();
  const { data: occ, reload } = useDataSync<OccurrenceDTO[]>(['event'], () =>
    window.apollo.call('events.list', { startMs: rangeStart, endMs: rangeEnd }),
  );

  const byDay = useMemo(() => {
    const map = new Map<string, OccurrenceDTO[]>();
    for (const o of occ ?? []) {
      const key = DateTime.fromMillis(o.occStartTs, { zone: o.tz }).toISODate() ?? '';
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return map;
  }, [occ]);

  const [dayPanel, setDayPanel] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [quickCreate, setQuickCreate] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
          {headers.map((hd) => (
            <div key={hd} style={{ padding: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>{hd}</div>
          ))}
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)' }}>
          {cells.map((cell) => {
            const events = byDay.get(cell.dateIso) ?? [];
            return (
              <div
                key={cell.dateIso}
                onClick={() => setDayPanel(cell.dateIso)}
                onDoubleClick={(ev) => { ev.stopPropagation(); setQuickCreate(cell.dateIso); }}
                style={{
                  border: '0.5px solid var(--border)',
                  padding: 'var(--sp-1)',
                  minHeight: 84,
                  background: cell.inMonth ? 'var(--surface)' : 'var(--bg)',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--fs-caption)',
                    color: cell.isToday ? '#fff' : cell.inMonth ? 'var(--text-1)' : 'var(--text-3)',
                    fontWeight: cell.isToday ? 700 : 400,
                    width: 22, height: 22, lineHeight: '22px', textAlign: 'center',
                    borderRadius: '50%',
                    background: cell.isToday ? 'var(--accent)' : 'transparent',
                  }}
                >
                  {cell.day}
                </div>
                {events.slice(0, 3).map((o) => (
                  <div
                    key={`${o.eventId}-${o.occStartTs}`}
                    onClick={(ev) => { ev.stopPropagation(); openEditorFor(o, setEditor); }}
                    style={{ ...chip, borderLeft: `3px solid ${calendarColor(o.calendarId)}`, paddingLeft: 4 }}
                    title={o.title}
                  >
                    {o.allDay ? '' : `${fmtTime(o.occStartTs, { tz: o.tz })} `}
                    {o.title}
                  </div>
                ))}
                {events.length > 3 ? (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', paddingLeft: 2 }}>{c.moreEvents(events.length - 3)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {dayPanel ? (
        <DayPanel
          dateIso={dayPanel}
          events={byDay.get(dayPanel) ?? []}
          onClose={() => setDayPanel(null)}
          onOpenEvent={(o) => openEditorFor(o, setEditor)}
          onNewEvent={() => setQuickCreate(dayPanel)}
          onOpenWeek={() => onNavigateWeek(dayPanel)}
        />
      ) : null}

      {quickCreate ? (
        <QuickCreatePopover
          dateIso={quickCreate}
          localTz={localTz}
          onClose={() => setQuickCreate(null)}
          onCreated={() => { setQuickCreate(null); reload(); }}
          onFullEditor={(init) => { setQuickCreate(null); setEditor({ mode: 'create', initial: init }); }}
        />
      ) : null}

      {editor ? (
        <EventEditorFlow state={editor} localTz={localTz} onClose={() => setEditor(null)} onDone={() => { setEditor(null); reload(); }} />
      ) : null}
    </div>
  );
}

type EditorState =
  | { mode: 'create'; initial: EditorInitial }
  | { mode: 'edit'; initial: EditorInitial };

function openEditorFor(o: OccurrenceDTO, setEditor: (s: EditorState) => void): void {
  void window.apollo.call('events.get', { id: o.eventId }).then((full) => {
    const start = DateTime.fromMillis(o.occStartTs, { zone: o.tz });
    const end = DateTime.fromMillis(o.occEndTs, { zone: o.tz });
    setEditor({
      mode: 'edit',
      initial: {
        id: full.id,
        title: full.title,
        startIso: start.toISO({ includeOffset: false }) ?? '',
        endIso: end.toISO({ includeOffset: false }) ?? '',
        allDay: full.allDay,
        tz: full.tz,
        rrule: full.rrule,
        location: full.location ?? '',
        notes: full.notes ?? '',
        reminderMin: null,
        isRecurring: o.isRecurring,
        occStartTs: o.occStartTs,
        calendarId: full.calendarId,
      },
    });
  });
}

function EventEditorFlow({
  state,
  onClose,
  onDone,
}: {
  state: EditorState;
  localTz: string;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [pending, setPending] = useState<{ result: EditorResult; kind: 'save' | 'delete' } | null>(null);

  const commit = (result: EditorResult, scope: 'single' | 'all' | null): void => {
    if (state.mode === 'create') {
      void window.apollo
        .call('events.create', {
          title: result.title, startIso: result.startIso, endIso: result.endIso, tz: result.tz,
          allDay: result.allDay, calendarId: result.calendarId, ...(result.rrule ? { rrule: result.rrule } : {}),
          ...(result.location ? { location: result.location } : {}),
          ...(result.notes ? { notes: result.notes } : {}),
          ...(result.reminderMin !== null ? { reminderMin: result.reminderMin } : {}),
        })
        .then(onDone);
      return;
    }
    void window.apollo
      .call('events.update', {
        id: result.id as string,
        patch: {
          title: result.title, startIso: result.startIso, endIso: result.endIso, tz: result.tz,
          allDay: result.allDay, rrule: result.rrule, location: result.location || null,
          notes: result.notes || null, reminderMin: result.reminderMin, calendarId: result.calendarId,
        },
        scope: scope ?? 'all',
        ...(state.initial.occStartTs !== undefined ? { occStartTs: state.initial.occStartTs } : {}),
      })
      .then(onDone);
  };

  const remove = (scope: 'single' | 'all' | null): void => {
    void window.apollo
      .call('events.delete', {
        id: state.initial.id as string,
        scope: scope ?? 'all',
        ...(state.initial.occStartTs !== undefined ? { occStartTs: state.initial.occStartTs } : {}),
      })
      .then(onDone);
  };

  if (pending) {
    return (
      <ScopeDialog
        onCancel={() => setPending(null)}
        onChoose={(scope) => (pending.kind === 'save' ? commit(pending.result, scope) : remove(scope))}
      />
    );
  }

  return (
    <EventEditorModal
      initial={state.initial}
      onClose={onClose}
      onSave={(result) => (state.mode === 'edit' && state.initial.isRecurring ? setPending({ result, kind: 'save' }) : commit(result, null))}
      onDelete={
        state.mode === 'edit'
          ? () => (state.initial.isRecurring ? setPending({ result: { ...emptyResult, id: state.initial.id }, kind: 'delete' }) : remove(null))
          : undefined
      }
    />
  );
}

const emptyResult: EditorResult = {
  title: '', startIso: '', endIso: '', allDay: false, tz: 'UTC', rrule: null, location: '', notes: '', reminderMin: null, calendarId: 'default',
};

/** I7 subtle sync indicator in the Calendar header (spinner / last synced / error+Retry). */
function GcalIndicator({ enabled }: { enabled: boolean }): React.JSX.Element | null {
  const [st, setSt] = useState<{ status: 'idle' | 'syncing' | 'error'; lastSyncTs: number | null } | null>(null);
  useEffect(() => window.apollo.on('google.state', (s) => setSt(s)), []);
  if (!enabled) return null;
  const g = STRINGS.gcal;
  const label =
    st?.status === 'syncing' ? g.syncing : st?.status === 'error' ? g.syncError : st?.lastSyncTs ? g.lastSync(fmtRelative(st.lastSyncTs)) : g.neverSynced;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: st?.status === 'error' ? 'var(--danger)' : 'var(--text-3)' }}>
      <span aria-hidden>{st?.status === 'syncing' ? '↻' : st?.status === 'error' ? '⚠' : '✓'}</span>
      <span>{label}</span>
      {st?.status === 'error' ? (
        <button onClick={() => void window.apollo.call('google.sync', {})} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-caption)' }}>{g.syncNow}</button>
      ) : null}
    </div>
  );
}

function DayPanel({
  dateIso,
  events,
  onClose,
  onOpenEvent,
  onNewEvent,
  onOpenWeek,
}: {
  dateIso: string;
  events: OccurrenceDTO[];
  onClose: () => void;
  onOpenEvent: (o: OccurrenceDTO) => void;
  onNewEvent: () => void;
  onOpenWeek: () => void;
}): React.JSX.Element {
  const c = STRINGS.workspace.calendar;
  return (
    <aside style={{ width: 300, borderLeft: '1px solid var(--border)', padding: 'var(--sp-4)', overflow: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <button onClick={onOpenWeek} style={{ ...linkBtn, fontWeight: 600, fontSize: 'var(--fs-body)' }}>
          {fmtDateIso(dateIso, 'weekday-full')}
        </button>
        <button onClick={onClose} style={linkBtn} aria-label="Close">✕</button>
      </div>
      {events.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>{STRINGS.workspace.today.emptyEvents}</div>
      ) : (
        events.map((o) => (
          <div key={`${o.eventId}-${o.occStartTs}`} onClick={() => onOpenEvent(o)} style={{ ...chip, whiteSpace: 'normal', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)', borderLeft: `3px solid ${calendarColor(o.calendarId)}` }}>
            <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: calendarColor(o.calendarId), flexShrink: 0 }} />{o.title}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
              {o.allDay ? STRINGS.cards.allDay : `${fmtTime(o.occStartTs, { tz: o.tz })}–${fmtTime(o.occEndTs, { tz: o.tz })}`}
            </div>
          </div>
        ))
      )}
      <button onClick={onNewEvent} style={{ ...ghost, marginTop: 'var(--sp-3)', width: '100%' }}>{c.newEvent}</button>
    </aside>
  );
}

function QuickCreatePopover({
  dateIso,
  localTz,
  onClose,
  onCreated,
  onFullEditor,
}: {
  dateIso: string;
  localTz: string;
  onClose: () => void;
  onCreated: () => void;
  onFullEditor: (init: EditorInitial) => void;
}): React.JSX.Element {
  const c = STRINGS.workspace.calendar;
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [durMin, setDurMin] = useState(60);
  const [allDay, setAllDay] = useState(false);

  const create = (): void => {
    if (!title.trim()) return;
    const start = DateTime.fromISO(`${dateIso}T${allDay ? '00:00' : time}`, { zone: localTz });
    const end = allDay ? start.endOf('day') : start.plus({ minutes: durMin });
    void window.apollo
      .call('events.create', {
        title: title.trim(),
        startIso: start.toISO({ includeOffset: false }) ?? '',
        endIso: end.toISO({ includeOffset: false }) ?? '',
        tz: localTz,
        allDay,
      })
      .then(onCreated);
  };

  const openFull = (): void => {
    const start = DateTime.fromISO(`${dateIso}T${time}`, { zone: localTz });
    onFullEditor({
      title: title.trim(),
      startIso: start.toISO({ includeOffset: false }) ?? '',
      endIso: start.plus({ minutes: durMin }).toISO({ includeOffset: false }) ?? '',
      allDay,
      tz: localTz,
      rrule: null,
      location: '',
      notes: '',
      reminderMin: null,
      isRecurring: false,
    });
  };

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90 }}
    >
      <div style={{ width: 320, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 'var(--sp-4)' }}>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>
          {fmtDateIso(dateIso, 'weekday-full')}
        </div>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder={c.titlePlaceholder} style={input} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', margin: 'var(--sp-2) 0', fontSize: 'var(--fs-body)' }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {c.durAllDay}
        </label>
        {!allDay ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...input, width: 120 }} />
            <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
              {([['30m', 30], ['1h', 60], ['2h', 120]] as const).map(([lbl, m]) => (
                <button key={m} onClick={() => setDurMin(m)} style={tabBtn(durMin === m)}>{lbl}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-2)' }}>
          <button onClick={openFull} style={linkBtn}>{c.newEvent}…</button>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button onClick={onClose} style={ghost}>{STRINGS.workspace.editor.cancel}</button>
            <button onClick={create} disabled={!title.trim()} style={{ ...primary, opacity: title.trim() ? 1 : 0.5 }}>{c.create}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const chip: React.CSSProperties = {
  fontSize: 'var(--fs-caption)',
  padding: '1px 4px',
  marginTop: 2,
  borderRadius: 4,
  background: 'var(--accent-soft)',
  color: 'var(--text-1)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'pointer',
};
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)',
  background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)',
});
const navBtn: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const primary: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const ghost: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const linkBtn: React.CSSProperties = {
  padding: 'var(--sp-1)', border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
  fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
