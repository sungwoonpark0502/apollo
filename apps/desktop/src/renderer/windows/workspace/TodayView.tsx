import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { calendarColor, fmtDate, fmtDateTime, fmtHour, fmtTime, STRINGS, type InvokeRes, type OccurrenceDTO, type Settings } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { WeatherGlyph } from '../../components/WeatherGlyph';

type Today = InvokeRes<'workspace.today'>;

export function TodayView({ settings, onOpenCalendar }: { settings: Settings | null; onOpenCalendar: (dateIso: string) => void }): React.JSX.Element {
  // Captured once at mount; the Today window is short-lived and re-opened fresh.
  const [now] = useState(() => DateTime.now());
  const partOfDay = now.hour < 12 ? 'morning' : now.hour < 18 ? 'afternoon' : 'evening';
  const name = settings?.profile.name ?? '';

  const dayStart = now.startOf('day').toMillis();
  const dayEnd = now.endOf('day').toMillis();

  const { data: occ } = useDataSync<OccurrenceDTO[]>(['event'], () => window.apollo.call('events.list', { startMs: dayStart, endMs: dayEnd }));
  const { data: todos, reload: reloadTodos } = useDataSync(['todo'], () => window.apollo.call('todos.list', {}));
  const { data: today } = useDataSync<Today>(['event'], () => window.apollo.call('workspace.today', {}));

  const upNext = useMemo(
    () => (occ ?? []).filter((o) => o.occStartTs >= now.toMillis()).slice(0, 3),
    [occ, now],
  );

  const rel = (ms: number): string => {
    const diff = Math.round((ms - now.toMillis()) / 60000);
    if (diff <= 0) return STRINGS.workspace.today.relNow;
    if (diff < 60) return STRINGS.workspace.today.relMin(diff);
    return STRINGS.workspace.today.relHour(Math.round(diff / 60));
  };

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

      <Section title={STRINGS.workspace.today.upNext} empty={upNext.length === 0 ? STRINGS.workspace.today.emptyUpNext : null}>
        {upNext.map((o) => (
          <Row key={`${o.eventId}-${o.occStartTs}`} onClick={() => onOpenCalendar(o.dateIso)}>
            <span>{o.title}</span>
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>{rel(o.occStartTs)}</span>
          </Row>
        ))}
      </Section>

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

      <TodosSection todos={todos ?? []} reload={reloadTodos} />

      <WeatherStrip weather={today?.weather ?? null} />

      <BriefSection brief={today?.brief ?? null} />
    </div>
  );
}

function TodosSection({
  todos,
  reload,
}: {
  todos: Array<{ id: string; content: string; dueTs: number | null; done: boolean }>;
  reload: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    void window.apollo.call('todos.add', { content }).then(reload);
  };
  const [now] = useState(() => Date.now());
  return (
    <Section title={STRINGS.workspace.today.todos} empty={null}>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={STRINGS.workspace.today.addTodo}
          style={inputStyle}
        />
      </div>
      {todos.length === 0 ? (
        <Empty text={STRINGS.workspace.today.emptyTodos} />
      ) : (
        todos.map((t) => {
          const overdue = !t.done && t.dueTs !== null && t.dueTs < now;
          return (
            <Row key={t.id}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer', flex: 1 }}>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => void window.apollo.call('todos.toggle', { id: t.id, done: e.target.checked }).then(reload)}
                />
                <span style={{ textDecoration: t.done ? 'line-through' : 'none', color: overdue ? 'var(--danger)' : 'var(--text-1)' }}>
                  {t.content}
                </span>
              </label>
              {t.dueTs !== null ? (
                <span style={{ fontSize: 'var(--fs-caption)', color: overdue ? 'var(--danger)' : 'var(--text-3)' }}>
                  {overdue ? STRINGS.workspace.today.overdue : fmtDateTime(t.dueTs, { dateStyle: 'date' })}
                </span>
              ) : null}
            </Row>
          );
        })
      )}
    </Section>
  );
}

function WeatherStrip({ weather }: { weather: Today['weather'] }): React.JSX.Element {
  return (
    <Section title={STRINGS.workspace.today.weather} empty={weather === null ? STRINGS.workspace.today.emptyWeather : null}>
      {weather ? (
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
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                  {fmtHour(DateTime.fromISO(hr.iso).hour)}
                </div>
                <WeatherGlyph condition={hr.condition} size={18} />
                <div style={{ fontSize: 'var(--fs-caption)' }}>{hr.temp}°</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function BriefSection({ brief }: { brief: Today['brief'] }): React.JSX.Element {
  const regenerate = (): void => {
    void window.apollo.call('agent.userMessage', { text: 'good morning', source: 'text', convId: `brief-${Date.now()}` });
  };
  return (
    <Section
      title={STRINGS.workspace.today.latestBrief}
      empty={brief === null ? STRINGS.workspace.today.emptyBrief : null}
      action={{ label: STRINGS.workspace.today.regenerate, onClick: regenerate }}
    >
      {brief && brief.kind === 'brief' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {brief.sections.map((s, i) => (
            <div key={i} style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)' }}>
              {s.kind === 'text' ? s.body : s.kind}
            </div>
          ))}
        </div>
      ) : null}
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
  return <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>{text}</div>;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
  outline: 'none',
};

const linkButton: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-caption)',
  color: 'var(--accent)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
