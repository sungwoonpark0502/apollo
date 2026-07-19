import React, { useEffect, useState } from 'react';
import { fmtDate } from '@apollo/shared';
import { listEvents, logout, type WebEventDto } from './api';
import { isoOf } from './webDate';
import { ChatApp } from './ChatApp';
import { NotesView } from './NotesView';
import { CalendarView } from './CalendarView';

/**
 * The web workspace: same rail and same order as the desktop (Home, Chat,
 * Calendar, Notes) with the account row at the foot. What a browser cannot do
 * — voice, wake word, screen context, local files — is exactly what Home's
 * footer points to the desktop app for, instead of pretending.
 */
type View = 'home' | 'chat' | 'calendar' | 'notes' | 'settings';

export interface WebUser {
  name: string;
  email: string;
  plan: string;
}

export function Workspace({ user, onSignedOut }: { user: WebUser; onSignedOut: () => void }): React.JSX.Element {
  // A ?q= deep link (Chrome extension) should land on Chat with the prefill.
  const [view, setView] = useState<View>(() => (new URLSearchParams(window.location.search).has('q') ? 'chat' : 'home'));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav style={{ width: 168, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 'var(--sp-3) var(--sp-2)', gap: 2 }}>
        <RailButton label="Home" glyph="⌂" active={view === 'home'} onClick={() => setView('home')} />
        <RailButton label="Chat" glyph="💬" active={view === 'chat'} onClick={() => setView('chat')} />
        <RailButton label="Calendar" glyph="▦" active={view === 'calendar'} onClick={() => setView('calendar')} />
        <RailButton label="Notes" glyph="≡" active={view === 'notes'} onClick={() => setView('notes')} />
        <div style={{ flex: 1 }} />
        <RailButton label="Settings" glyph="⚙" active={view === 'settings'} onClick={() => setView('settings')} />
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 'var(--sp-2)', paddingTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          <div style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
        </div>
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'home' ? <HomeView user={user} onOpenCalendar={() => setView('calendar')} /> : null}
        {view === 'chat' ? <ChatApp user={user} onSignedOut={onSignedOut} /> : null}
        {view === 'calendar' ? <CalendarView /> : null}
        {view === 'notes' ? <NotesView /> : null}
        {view === 'settings' ? <SettingsView user={user} onSignedOut={onSignedOut} /> : null}
      </div>
    </div>
  );
}

function RailButton({ label, glyph, active, onClick }: { label: string; glyph: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', width: '100%', height: 38,
        border: 'none', borderRadius: 'var(--radius-ctl)', cursor: 'pointer', textAlign: 'left',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-2)',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', fontWeight: active ? 500 : 400,
        padding: '0 var(--sp-2)',
      }}
    >
      <span style={{ width: 20, textAlign: 'center' }} aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </button>
  );
}

function HomeView({ user, onOpenCalendar }: { user: WebUser; onOpenCalendar: () => void }): React.JSX.Element {
  const [events, setEvents] = useState<WebEventDto[] | null>(null);
  const todayIso = isoOf(new Date());

  useEffect(() => {
    const from = `${todayIso}T00:00:00`;
    const to = `${todayIso}T23:59:59`;
    void listEvents(from, to).then(setEvents);
  }, [todayIso]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-6)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' }}>
          {greeting}{user.name ? `, ${user.name}` : ''}.
        </h1>
        <p style={{ color: 'var(--text-3)', margin: '0 0 var(--sp-5)' }}>
          {fmtDate(Date.now(), 'weekday-full')}
        </p>

        <h2 style={{ fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)' }}>Today</h2>
        {events === null ? (
          <p style={{ color: 'var(--text-3)' }}>…</p>
        ) : events.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>Nothing scheduled today.</p>
        ) : (
          events.map((e) => (
            <button key={e.id} onClick={onOpenCalendar} style={homeEventRow}>
              <span style={{ minWidth: 88, color: 'var(--text-2)' }}>
                {e.allDay ? 'All day' : `${e.startIso.slice(11, 16)}–${e.endIso.slice(11, 16)}`}
              </span>
              <span style={{ fontWeight: 500 }}>{e.title}</span>
              {e.location ? <span style={{ color: 'var(--text-3)' }}> · {e.location}</span> : null}
            </button>
          ))
        )}

        <p style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          Voice, reminders, files, and screen context live in the Apollo desktop app.
        </p>
      </div>
    </div>
  );
}

function SettingsView({ user, onSignedOut }: { user: WebUser; onSignedOut: () => void }): React.JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-6)' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>Settings</h1>

        <section style={card}>
          <h2 style={h2}>Account</h2>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{user.name || user.email}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{user.email} · {user.plan} plan</div>
          <button onClick={() => void logout().then(onSignedOut)} style={{ ...outBtn, marginTop: 'var(--sp-3)' }}>
            Log out
          </button>
        </section>

        <section style={card}>
          <h2 style={h2}>Your data</h2>
          <p style={p}>
            Notes and calendar created here are stored with your Apollo account, so they follow you to any browser.
            Chat history stays in this browser only.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>Desktop app</h2>
          <p style={p}>
            Voice ("Hey Apollo"), reminders, screen context, local file search, and quiet-hours nudges run in the
            desktop app. Wake word, model choice per conversation, and every capability setting live in its Settings.
          </p>
        </section>
      </div>
    </div>
  );
}

const homeEventRow: React.CSSProperties = {
  display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline', width: '100%', textAlign: 'left',
  border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-2)', cursor: 'pointer',
  color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)',
};
const h2: React.CSSProperties = { fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)' };
const p: React.CSSProperties = { fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: 0, lineHeight: 1.5 };
const outBtn: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
