import React, { useCallback, useEffect, useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { useNavigate, useSettings } from '../../lib/useLive';
import { TodayView } from './TodayView';
import { CalendarView } from './CalendarView';
import { NotesView } from './NotesView';
import { ChatsView } from './ChatsView';
import { OmniSearch } from './OmniSearch';

type View = 'today' | 'calendar' | 'notes' | 'chats';

const RAIL_W = 64;

export function WorkspaceApp(): React.JSX.Element {
  const [view, setView] = useState<View>('today');
  const [navDateIso, setNavDateIso] = useState<string | undefined>(undefined);
  const [navNoteId, setNavNoteId] = useState<string | undefined>(undefined);
  const [omniOpen, setOmniOpen] = useState(false);
  const settings = useSettings();

  useNavigate((v, dateIso, noteId) => {
    setView(v);
    setNavDateIso(dateIso);
    setNavNoteId(noteId);
  });

  const go = useCallback((v: View) => {
    setView(v);
    setNavDateIso(undefined);
    setNavNoteId(undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { setOmniOpen((v) => !v); e.preventDefault(); }
      else if (mod && e.key === '1') { go('today'); e.preventDefault(); }
      else if (mod && e.key === '2') { go('calendar'); e.preventDefault(); }
      else if (mod && e.key === '3') { go('notes'); e.preventDefault(); }
      else if (!mod && e.key.toLowerCase() === 't' && !isTyping(e)) { go('today'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <nav
        style={{
          width: RAIL_W,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 'var(--sp-3) 0',
          gap: 'var(--sp-2)',
        }}
      >
        <RailButton label={STRINGS.workspace.nav.today} active={view === 'today'} onClick={() => go('today')} glyph="◉" />
        <RailButton label={STRINGS.workspace.nav.calendar} active={view === 'calendar'} onClick={() => go('calendar')} glyph="▦" />
        <RailButton label={STRINGS.workspace.nav.notes} active={view === 'notes'} onClick={() => go('notes')} glyph="≡" />
        {settings?.history.enabled ? (
          <RailButton label={STRINGS.workspace.nav.chats} active={view === 'chats'} onClick={() => go('chats')} glyph="✻" />
        ) : null}
        <div style={{ flex: 1 }} />
        <RailButton
          label={STRINGS.workspace.nav.settings}
          active={false}
          onClick={() => void window.apollo.call('settings.open', {})}
          glyph="⚙"
        />
      </nav>
      <main style={{ flex: 1, overflow: 'auto' }}>
        {view === 'today' ? (
          <TodayView settings={settings} onOpenCalendar={(dateIso) => { setView('calendar'); setNavDateIso(dateIso); }} />
        ) : view === 'calendar' ? (
          <CalendarView settings={settings} initialDateIso={navDateIso} />
        ) : view === 'chats' ? (
          <ChatsView />
        ) : (
          <NotesView initialNoteId={navNoteId} />
        )}
      </main>
      {omniOpen ? (
        <OmniSearch
          onClose={() => setOmniOpen(false)}
          onNavigate={(t) => {
            if (t.view === 'notes') { setView('notes'); setNavNoteId(t.noteId); setNavDateIso(undefined); }
            else { setView('calendar'); setNavDateIso(t.dateIso); setNavNoteId(undefined); }
          }}
        />
      ) : null}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function RailButton({ label, glyph, active, onClick }: { label: string; glyph: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        width: 44,
        height: 44,
        borderRadius: 'var(--radius-ctl)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 20,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glyph}
    </button>
  );
}
