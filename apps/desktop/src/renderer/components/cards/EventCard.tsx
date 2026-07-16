import React, { useState } from 'react';
import { fmtDate, fmtRange, STRINGS, type EventDTO } from '@apollo/shared';
import { buttonStyle } from './TimerCard';
import { eventToIcs } from '../../lib/ics';

function timeRange(e: EventDTO): string {
  const day = fmtDate(e.startTs, 'weekday-date', { tz: e.tz });
  if (e.allDay) return `${day} · ${STRINGS.cards.allDay}`;
  return `${day} · ${fmtRange(e.startTs, e.endTs, { tz: e.tz })}`;
}

export function EventCard({ event }: { event: EventDTO }): React.JSX.Element {
  const [deleted, setDeleted] = useState(false);
  const [copied, setCopied] = useState(false);

  const del = (): void => {
    void window.apollo.call('data.mutate', { op: 'deleteEvent', id: event.id }).then(() => setDeleted(true));
  };
  const copyIcs = (): void => {
    void navigator.clipboard.writeText(eventToIcs(event)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', opacity: deleted ? 0.5 : 1 }}>
      <div>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 500, textDecoration: deleted ? 'line-through' : 'none', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: event.color, flexShrink: 0 }} />
          {event.title}
        </div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginTop: 'var(--sp-1)' }}>{timeRange(event)}</div>
        {event.location ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>{event.location}</div>
        ) : null}
      </div>
      {!deleted ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', flexShrink: 0 }}>
          <button onClick={copyIcs} style={buttonStyle}>{copied ? STRINGS.cards.copied : STRINGS.cards.copyIcs}</button>
          <button onClick={del} style={buttonStyle}>{STRINGS.cards.delete}</button>
        </div>
      ) : null}
    </div>
  );
}

export function EventListCard({ title, events }: { title: string; events: EventDTO[] }): React.JSX.Element {
  const shown = events.slice(0, 5);
  const more = events.length - shown.length;
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>{title}</div>
      {shown.map((e, i) => (
        <div key={`${e.id}-${e.startTs}-${i}`} style={{ padding: 'var(--sp-1) 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
          <span style={{ fontWeight: 500 }}>{e.title}</span>
          <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)', marginLeft: 'var(--sp-2)' }}>{timeRange(e)}</span>
        </div>
      ))}
      {more > 0 ? (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>{STRINGS.cards.moreEvents(more)}</div>
      ) : null}
    </div>
  );
}
