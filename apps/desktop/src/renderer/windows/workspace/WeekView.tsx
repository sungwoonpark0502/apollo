import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { fmtDate, fmtHour, fmtTime, STRINGS, type OccurrenceDTO } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { layoutOverlaps, snap15 } from '../../lib/calendarLayout';
import { EventEditorModal, type EditorInitial } from './EventEditorModal';
import { ScopeDialog } from './ScopeDialog';

const HOUR_PX = 44;               // vertical pixels per hour
const INITIAL_SCROLL_HOUR = 6;    // E3.2

export function WeekView({ anchor, localTz }: { anchor: DateTime; localTz: string }): React.JSX.Element {
  const weekStartDt = useMemo(() => anchor.startOf('week'), [anchor]); // luxon week starts Monday
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStartDt.plus({ days: i })), [weekStartDt]);
  const rangeStart = weekStartDt.startOf('day').toMillis();
  const rangeEnd = weekStartDt.plus({ days: 7 }).startOf('day').toMillis();

  const { data: occ, reload } = useDataSync<OccurrenceDTO[]>(['event'], () =>
    window.apollo.call('events.list', { startMs: rangeStart, endMs: rangeEnd }),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX;
  }, []);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [editor, setEditor] = useState<{ initial: EditorInitial } | null>(null);
  const [scopePrompt, setScopePrompt] = useState<{ o: OccurrenceDTO; startTs: number; endTs: number } | null>(null);

  const allDayByDay = useMemo(() => bucketAllDay(occ ?? [], days), [occ, days]);
  const timedByDay = useMemo(() => bucketTimed(occ ?? [], days), [occ, days]);

  /** Persist a moved/resized occurrence; recurring ones ask scope first. */
  const persistMove = (o: OccurrenceDTO, startTs: number, endTs: number): void => {
    if (o.isRecurring) {
      setScopePrompt({ o, startTs, endTs });
      return;
    }
    void window.apollo
      .call('events.update', {
        id: o.eventId,
        patch: {
          startIso: DateTime.fromMillis(startTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
          endIso: DateTime.fromMillis(endTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
        },
        scope: 'all',
      })
      .then(reload);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* all-day row pinned to top */}
      <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(7, 1fr)`, borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: 'var(--sp-1)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{STRINGS.workspace.calendar.allDay}</div>
        {days.map((d, i) => (
          <div key={d.toISODate()} style={{ borderLeft: '0.5px solid var(--border)', padding: 2, minHeight: 24 }}>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>{fmtDate(d.toMillis(), 'weekday-day')}</div>
            {(allDayByDay[i] ?? []).map((o) => (
              <div key={`${o.eventId}-${o.occStartTs}`} style={allDayChip} onClick={() => openEditor(o, setEditor)} title={o.title}>{o.title}</div>
            ))}
          </div>
        ))}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(7, 1fr)`, height: 24 * HOUR_PX, position: 'relative' }}>
          {/* hour gutter */}
          <div style={{ position: 'relative' }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ position: 'absolute', top: h * HOUR_PX - 6, right: 4, fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{fmtHour(h)}</div>
            ))}
          </div>

          {days.map((d, i) => (
            <DayColumn
              key={d.toISODate()}
              day={d}
              events={timedByDay[i] ?? []}
              nowMs={nowMs}
              onCreate={(startTs, endTs) => {
                void window.apollo
                  .call('events.create', {
                    title: STRINGS.workspace.calendar.newEvent,
                    startIso: DateTime.fromMillis(startTs, { zone: localTz }).toISO({ includeOffset: false }) ?? '',
                    endIso: DateTime.fromMillis(endTs, { zone: localTz }).toISO({ includeOffset: false }) ?? '',
                    tz: localTz,
                  })
                  .then(reload);
              }}
              onMove={persistMove}
              onOpen={(o) => openEditor(o, setEditor)}
            />
          ))}
        </div>
      </div>

      {editor ? (
        <EventEditorModal
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSave={(r) => {
            const doSave = (scope: 'single' | 'all' | null): void => {
              void window.apollo
                .call('events.update', {
                  id: r.id as string,
                  patch: { title: r.title, startIso: r.startIso, endIso: r.endIso, tz: r.tz, allDay: r.allDay, rrule: r.rrule, location: r.location || null, notes: r.notes || null, reminderMin: r.reminderMin },
                  scope: scope ?? 'all',
                  ...(editor.initial.occStartTs !== undefined ? { occStartTs: editor.initial.occStartTs } : {}),
                })
                .then(() => { setEditor(null); reload(); });
            };
            doSave(editor.initial.isRecurring ? 'single' : null);
          }}
          onDelete={() => {
            void window.apollo
              .call('events.delete', { id: editor.initial.id as string, scope: editor.initial.isRecurring ? 'single' : 'all', ...(editor.initial.occStartTs !== undefined ? { occStartTs: editor.initial.occStartTs } : {}) })
              .then(() => { setEditor(null); reload(); });
          }}
        />
      ) : null}

      {scopePrompt ? (
        <ScopeDialog
          onCancel={() => { setScopePrompt(null); reload(); }}
          onChoose={(scope) => {
            const { o, startTs, endTs } = scopePrompt;
            void window.apollo
              .call('events.update', {
                id: o.eventId,
                patch: {
                  startIso: DateTime.fromMillis(startTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
                  endIso: DateTime.fromMillis(endTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
                },
                scope,
                occStartTs: o.occStartTs,
              })
              .then(() => { setScopePrompt(null); reload(); });
          }}
        />
      ) : null}
    </div>
  );
}

function DayColumn({
  day,
  events,
  nowMs,
  onCreate,
  onMove,
  onOpen,
}: {
  day: DateTime;
  events: OccurrenceDTO[];
  nowMs: number;
  onCreate: (startTs: number, endTs: number) => void;
  onMove: (o: OccurrenceDTO, startTs: number, endTs: number) => void;
  onOpen: (o: OccurrenceDTO) => void;
}): React.JSX.Element {
  const colRef = useRef<HTMLDivElement>(null);
  const dayStart = day.startOf('day');
  const [dragCreate, setDragCreate] = useState<{ y0: number; y1: number } | null>(null);

  const laid = useMemo(
    () => layoutOverlaps(events.map((o) => ({ id: `${o.eventId}-${o.occStartTs}`, startMs: o.occStartTs, endMs: o.occEndTs }))),
    [events],
  );
  const byId = useMemo(() => new Map(events.map((o) => [`${o.eventId}-${o.occStartTs}`, o])), [events]);

  const yToMs = (y: number): number => snap15(dayStart.toMillis() + (y / HOUR_PX) * 3_600_000);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.target !== colRef.current) return; // only empty space
    const rect = colRef.current!.getBoundingClientRect();
    const y0 = e.clientY - rect.top;
    setDragCreate({ y0, y1: y0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragCreate) return;
    const rect = colRef.current!.getBoundingClientRect();
    setDragCreate({ y0: dragCreate.y0, y1: e.clientY - rect.top });
  };
  const onPointerUp = (): void => {
    if (!dragCreate) return;
    const a = Math.min(dragCreate.y0, dragCreate.y1);
    const b = Math.max(dragCreate.y0, dragCreate.y1);
    const startTs = yToMs(a);
    const endTs = Math.max(startTs + 15 * 60_000, yToMs(b));
    setDragCreate(null);
    onCreate(startTs, endTs);
  };

  const isToday = day.hasSame(DateTime.fromMillis(nowMs), 'day');
  const nowY = ((nowMs - dayStart.toMillis()) / 3_600_000) * HOUR_PX;

  return (
    <div
      ref={colRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ position: 'relative', borderLeft: '0.5px solid var(--border)', cursor: 'crosshair' }}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ position: 'absolute', top: h * HOUR_PX, left: 0, right: 0, borderTop: '0.5px solid var(--border)', opacity: 0.5 }} />
      ))}

      {laid.map((l) => {
        const o = byId.get(l.id)!;
        const top = ((o.occStartTs - dayStart.toMillis()) / 3_600_000) * HOUR_PX;
        const height = Math.max(14, ((o.occEndTs - o.occStartTs) / 3_600_000) * HOUR_PX);
        const width = `calc(${100 / l.lanes}% - 2px)`;
        const left = `calc(${(100 / l.lanes) * l.lane}% + 1px)`;
        return (
          <TimedChip
            key={l.id}
            o={o}
            top={top}
            height={height}
            left={left}
            width={width}
            hourPx={HOUR_PX}
            onOpen={() => onOpen(o)}
            onMove={onMove}
            dayStartMs={dayStart.toMillis()}
          />
        );
      })}

      {dragCreate ? (
        <div
          style={{
            position: 'absolute',
            top: Math.min(dragCreate.y0, dragCreate.y1),
            height: Math.abs(dragCreate.y1 - dragCreate.y0),
            left: 1,
            right: 1,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {isToday ? <div style={{ position: 'absolute', top: nowY, left: 0, right: 0, height: 2, background: 'var(--danger)', pointerEvents: 'none', zIndex: 5 }} /> : null}
    </div>
  );
}

function TimedChip({
  o,
  top,
  height,
  left,
  width,
  hourPx,
  dayStartMs,
  onOpen,
  onMove,
}: {
  o: OccurrenceDTO;
  top: number;
  height: number;
  left: string;
  width: string;
  hourPx: number;
  dayStartMs: number;
  onOpen: () => void;
  onMove: (o: OccurrenceDTO, startTs: number, endTs: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ mode: 'move' | 'resize'; startY: number; origStart: number; origEnd: number } | null>(null);
  const [preview, setPreview] = useState<{ top: number; height: number } | null>(null);

  const pxToMs = (px: number): number => (px / hourPx) * 3_600_000;

  const begin = (mode: 'move' | 'resize', e: React.PointerEvent): void => {
    e.stopPropagation();
    drag.current = { mode, startY: e.clientY, origStart: o.occStartTs, origEnd: o.occEndTs };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    e.stopPropagation();
    const dy = e.clientY - drag.current.startY;
    if (drag.current.mode === 'move') {
      const newStart = snap15(drag.current.origStart + pxToMs(dy));
      const dur = drag.current.origEnd - drag.current.origStart;
      setPreview({ top: ((newStart - dayStartMs) / 3_600_000) * hourPx, height: (dur / 3_600_000) * hourPx });
    } else {
      const newEnd = Math.max(drag.current.origStart + 15 * 60_000, snap15(drag.current.origEnd + pxToMs(dy)));
      setPreview({ top, height: ((newEnd - drag.current.origStart) / 3_600_000) * hourPx });
    }
  };
  const end = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    e.stopPropagation();
    const dy = e.clientY - drag.current.startY;
    const moved = Math.abs(dy) > 3;
    if (moved) {
      if (drag.current.mode === 'move') {
        const newStart = snap15(drag.current.origStart + pxToMs(dy));
        const dur = drag.current.origEnd - drag.current.origStart;
        onMove(o, newStart, newStart + dur);
      } else {
        const newEnd = Math.max(drag.current.origStart + 15 * 60_000, snap15(drag.current.origEnd + pxToMs(dy)));
        onMove(o, drag.current.origStart, newEnd);
      }
    } else {
      onOpen();
    }
    drag.current = null;
    setPreview(null);
  };

  return (
    <div
      onPointerDown={(e) => begin('move', e)}
      onPointerMove={move}
      onPointerUp={end}
      style={{
        position: 'absolute',
        top: preview?.top ?? top,
        height: preview?.height ?? height,
        left,
        width,
        background: 'var(--accent-soft)',
        borderLeft: '2px solid var(--accent)',
        borderRadius: 4,
        padding: '1px 4px',
        fontSize: 'var(--fs-caption)',
        overflow: 'hidden',
        cursor: 'grab',
        zIndex: 2,
      }}
      title={o.title}
    >
      <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.title}</div>
      <div style={{ color: 'var(--text-2)' }}>{fmtTime(o.occStartTs, { tz: o.tz })}</div>
      <div
        onPointerDown={(e) => begin('resize', e)}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 6, cursor: 'ns-resize' }}
      />
    </div>
  );
}

function openEditor(o: OccurrenceDTO, setEditor: (s: { initial: EditorInitial }) => void): void {
  void window.apollo.call('events.get', { id: o.eventId }).then((full) => {
    setEditor({
      initial: {
        id: full.id,
        title: full.title,
        startIso: DateTime.fromMillis(o.occStartTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
        endIso: DateTime.fromMillis(o.occEndTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
        allDay: full.allDay,
        tz: full.tz,
        rrule: full.rrule,
        location: full.location ?? '',
        notes: full.notes ?? '',
        reminderMin: null,
        isRecurring: o.isRecurring,
        occStartTs: o.occStartTs,
      },
    });
  });
}

function bucketAllDay(occ: OccurrenceDTO[], days: DateTime[]): OccurrenceDTO[][] {
  return days.map((d) => occ.filter((o) => o.allDay && DateTime.fromMillis(o.occStartTs, { zone: o.tz }).hasSame(d, 'day')));
}
function bucketTimed(occ: OccurrenceDTO[], days: DateTime[]): OccurrenceDTO[][] {
  return days.map((d) => occ.filter((o) => !o.allDay && DateTime.fromMillis(o.occStartTs, { zone: o.tz }).hasSame(d, 'day')));
}

const allDayChip: React.CSSProperties = {
  fontSize: 'var(--fs-caption)', background: 'var(--accent-soft)', borderRadius: 4, padding: '0 4px', marginBottom: 2,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer',
};
