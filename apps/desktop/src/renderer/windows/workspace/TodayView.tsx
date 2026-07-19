import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { calendarColor, fmtDate, fmtHour, fmtTime, STRINGS, type InvokeRes, type OccurrenceDTO, type Settings } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { WeatherGlyph } from '../../components/WeatherGlyph';

type Today = InvokeRes<'workspace.today'>;

/**
 * L2 Today: exactly a header, today's schedule, weather, and today's news —
 * nothing else. The prior Up-next, Reminders, To-dos, and Latest-brief sections
 * are removed (reminders still fire; they surface via notifications and nudges).
 */
export function TodayView({ settings, onOpenCalendar }: { settings: Settings | null; onOpenCalendar: (dateIso: string) => void }): React.JSX.Element {
  // Captured once at mount; the Today window is short-lived and re-opened fresh.
  const [now] = useState(() => DateTime.now());
  const partOfDay = now.hour < 12 ? 'morning' : now.hour < 18 ? 'afternoon' : 'evening';
  const name = settings?.profile.name ?? '';

  const dayStart = now.startOf('day').toMillis();
  const dayEnd = now.endOf('day').toMillis();

  const { data: occ } = useDataSync<OccurrenceDTO[]>(['event'], () => window.apollo.call('events.list', { startMs: dayStart, endMs: dayEnd }));
  const { data: today, reload: reloadToday } = useDataSync<Today>(['event'], () => window.apollo.call('workspace.today', {}));

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--sp-6)' }}>
      <header style={{ marginBottom: 'var(--sp-5)' }}>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {fmtDate(now.toMillis(), 'full')}
        </div>
        <h1 style={{ fontSize: 'var(--fs-display)', margin: 'var(--sp-1) 0 0', fontWeight: 600 }}>
          {STRINGS.workspace.greeting(name, partOfDay)}
        </h1>
      </header>

      <Section title={STRINGS.workspace.today.todaysEvents} empty={(occ ?? []).length === 0 ? STRINGS.workspace.today.emptyEvents : null}>
        {(occ ?? []).map((o) => (
          <Row key={`${o.eventId}-${o.occStartTs}`} onClick={() => onOpenCalendar(o.dateIso)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: calendarColor(o.calendarId), flexShrink: 0 }} />
              {o.title}
            </span>
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>
              {o.allDay ? STRINGS.cards.allDay : `${fmtTime(o.occStartTs, { tz: o.tz })}–${fmtTime(o.occEndTs, { tz: o.tz })}`}
            </span>
          </Row>
        ))}
      </Section>

      <WeatherStrip weather={today?.weather ?? null} onRefresh={reloadToday} />

      <NewsSection items={today?.news ?? []} onRefresh={reloadToday} />
    </div>
  );
}

function WeatherStrip({ weather, onRefresh }: { weather: Today['weather']; onRefresh: () => void }): React.JSX.Element {
  // L2: an unset home place gets a single "Set your location" action.
  if (weather === null) {
    return (
      <Section
        title={STRINGS.workspace.today.weather}
        empty={null}
        action={{ label: STRINGS.workspace.today.refresh, onClick: onRefresh }}
      >
        <Row onClick={() => void window.apollo.call('settings.open', {})}>
          <span style={{ color: 'var(--text-2)' }}>{STRINGS.workspace.today.emptyWeather}</span>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-caption)' }}>{STRINGS.workspace.today.setLocation}</span>
        </Row>
      </Section>
    );
  }
  return (
    <Section title={STRINGS.workspace.today.weather} empty={null} action={{ label: STRINGS.workspace.today.refresh, onClick: onRefresh }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <WeatherGlyph condition={weather.now.condition} size={28} />
          <span style={{ fontSize: 28, fontWeight: 600 }}>{weather.now.tempF}°</span>
          <span style={{ color: 'var(--text-2)' }}>{weather.now.condition}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>{weather.place}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
          {weather.hours.map((hr) => (
            <div key={hr.iso} style={{ textAlign: 'center', minWidth: 44 }}>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{fmtHour(DateTime.fromISO(hr.iso).hour)}</div>
              <WeatherGlyph condition={hr.condition} size={18} />
              <div style={{ fontSize: 'var(--fs-caption)' }}>{hr.temp}°</div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function NewsSection({ items, onRefresh }: { items: Today['news']; onRefresh: () => void }): React.JSX.Element {
  return (
    <Section
      title={STRINGS.workspace.today.news}
      empty={items.length === 0 ? STRINGS.workspace.today.emptyNews : null}
      action={{ label: STRINGS.workspace.today.refresh, onClick: onRefresh }}
    >
      {items.map((n) => (
        <Row key={n.url} onClick={() => void window.apollo.call('link.preview', { url: n.url })}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)', flexShrink: 0, marginLeft: 'var(--sp-2)' }}>{n.source}</span>
        </Row>
      ))}
    </Section>
  );
}

function Section({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  empty: string | null;
  action?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section style={{ marginBottom: 'var(--sp-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
        <h2 style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-3)', margin: 0 }}>
          {title}
        </h2>
        {action ? (
          <button onClick={action.onClick} style={linkButton}>
            {action.label}
          </button>
        ) : null}
      </div>
      {empty ? <Empty text={empty} /> : children}
    </section>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--sp-2) var(--sp-3)',
        borderRadius: 'var(--radius-ctl)',
        cursor: onClick ? 'pointer' : 'default',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        marginBottom: 'var(--sp-1)',
      }}
    >
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)', padding: 'var(--sp-2) var(--sp-3)' }}>{text}</div>;
}

const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 'var(--fs-caption)',
  fontFamily: 'var(--font-sans)',
  padding: 0,
};
