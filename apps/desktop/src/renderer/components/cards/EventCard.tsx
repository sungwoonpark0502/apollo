import React, { useState } from 'react';
import { STRINGS, type EventDTO } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

function timeRange(e: EventDTO): string {
  const start = new Date(e.startTs);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (e.allDay) return `${day} · ${STRINGS.cards.allDay}`;
  const t = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return e.endTs ? `${day} · ${t(e.startTs)} – ${t(e.endTs)}` : `${day} · ${t(e.startTs)}`;
}

export function EventCard({ event }: { event: EventDTO }): React.JSX.Element {
  const [deleted, setDeleted] = useState(false);

  const del = (): void => {
    void window.apollo.call('data.mutate', { op: 'deleteEvent', id: event.id }).then(() => setDeleted(true));
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', opacity: deleted ? 0.5 : 1 }}>
      <div>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 500, textDecoration: deleted ? 'line-through' : 'none' }}>{event.title}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginTop: 'var(--sp-1)' }}>{timeRange(event)}</div>
        {event.location ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>{event.location}</div>
        ) : null}
      </div>
      {!deleted ? (
        <button onClick={del} style={buttonStyle}>
          {STRINGS.cards.delete}
        </button>
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
