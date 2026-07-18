import React, { useCallback, useEffect, useState } from 'react';
import { matchesBinding, shortcut, STRINGS } from '@apollo/shared';
import { useFormatInit, useNavigate, useSettings } from '../../lib/useLive';
import { TodayView } from './TodayView';
import { CalendarView } from './CalendarView';
import { NotesView } from './NotesView';
import { ChatView } from './ChatView';
import { OmniSearch } from './OmniSearch';
import { ShortcutsHelp } from './ShortcutsHelp';

/** Match a keyboard event against a registered shortcut id (single source, I6). */
function isShortcut(id: string, e: KeyboardEvent): boolean {
  const b = shortcut(id)?.binding;
  return !!b && matchesBinding(b, e);
}

type View = 'chat' | 'today' | 'calendar' | 'notes';

const RAIL_W = 64;

export function WorkspaceApp(): React.JSX.Element {
  useFormatInit();
  const [view, setView] = useState<View>('chat'); // K1: workspace.defaultView default
  const [navDateIso, setNavDateIso] = useState<string | undefined>(undefined);
  const [navNoteId, setNavNoteId] = useState<string | undefined>(undefined);
  const [navConvId, setNavConvId] = useState<string | undefined>(undefined);
  const [omniOpen, setOmniOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [keysBanner, setKeysBanner] = useState(false);
  const [appliedDefault, setAppliedDefault] = useState(false);
  const settings = useSettings();

  // K1: land on the configured default view once settings arrive (deep links
  // win; adjust-during-render keeps this cascade-free).
  if (!appliedDefault && settings) {
    setAppliedDefault(true);
    setView((v) => (v === 'chat' ? settings.workspace.defaultView : v));
  }

  // I6: a persistent, dismissible banner when required keys are missing, instead of silent degradation.
  useEffect(() => {
    void window.apollo.call('keys.info', {}).then((info) => {
      const has = (p: string): boolean => info.some((k) => k.provider === p && k.configured);
      if (!has('anthropic') || !has('deepgram')) setKeysBanner(true);
    });
  }, []);

  // I3 global undo: Cmd/Ctrl+Z reverses the most recent action across surfaces,
  // including after a per-action toast has expired (up to 10 back).
  const undoLatest = useCallback(() => {
    void window.apollo.call('undo.latest', {}).then((r) => {
      setUndoToast(r.ok && r.label ? STRINGS.workspace.undo.undid(r.label) : STRINGS.workspace.undo.nothing);
      window.setTimeout(() => setUndoToast(null), 3000);
    });
  }, []);

  useNavigate((v, dateIso, noteId, convId) => {
    setView(v);
    setNavDateIso(dateIso);
    setNavNoteId(noteId);
    setNavConvId(convId);
  });

  const go = useCallback((v: View) => {
    setView(v);
    setNavDateIso(undefined);
    setNavNoteId(undefined);
    setNavConvId(undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // I6: bindings come from the shortcuts registry so help + behavior stay in sync.
      if (isShortcut('workspace.omnisearch', e)) { setOmniOpen((v) => !v); e.preventDefault(); }
      else if ((isShortcut('workspace.help', e) || isShortcut('workspace.helpAlt', e)) && !isTyping(e)) { setHelpOpen((v) => !v); e.preventDefault(); }
      else if (isShortcut('workspace.undo', e) && !isTyping(e)) { undoLatest(); e.preventDefault(); }
      else if (isShortcut('workspace.chat', e)) { go('chat'); e.preventDefault(); }
      else if (isShortcut('workspace.today', e)) { go('today'); e.preventDefault(); }
      else if (isShortcut('workspace.calendar', e)) { go('calendar'); e.preventDefault(); }
      else if (isShortcut('workspace.notes', e)) { go('notes'); e.preventDefault(); }
      else if (isShortcut('calendar.today', e) && !isTyping(e)) { go('today'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, undoLatest]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      {keysBanner ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-4)', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-caption)' }}>
          <span style={{ flex: 1 }}>{STRINGS.onboarding.keysSkippedBanner}</span>
          <button onClick={() => void window.apollo.call('settings.open', {})} style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-1)', borderRadius: 'var(--radius-ctl)', padding: '1px var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)' }}>{STRINGS.onboarding.keysSkippedAction}</button>
          <button onClick={() => setKeysBanner(false)} aria-label={STRINGS.onboarding.dismiss} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}>✕</button>
        </div>
      ) : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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
        <RailButton label={STRINGS.workspace.nav.chat} active={view === 'chat'} onClick={() => go('chat')} glyph="✻" />
        <RailButton label={STRINGS.workspace.nav.today} active={view === 'today'} onClick={() => go('today')} glyph="◉" />
        <RailButton label={STRINGS.workspace.nav.calendar} active={view === 'calendar'} onClick={() => go('calendar')} glyph="▦" />
        <RailButton label={STRINGS.workspace.nav.notes} active={view === 'notes'} onClick={() => go('notes')} glyph="≡" />
        <div style={{ flex: 1 }} />
        <RailButton
          label={STRINGS.workspace.nav.settings}
          active={false}
          onClick={() => void window.apollo.call('settings.open', {})}
          glyph="⚙"
        />
      </nav>
      <main style={{ flex: 1, overflow: view === 'chat' ? 'hidden' : 'auto', display: view === 'chat' ? 'flex' : undefined }}>
        {view === 'chat' ? (
          <ChatView settings={settings} initialConvId={navConvId} />
        ) : view === 'today' ? (
          <TodayView settings={settings} onOpenCalendar={(dateIso) => { setView('calendar'); setNavDateIso(dateIso); }} />
        ) : view === 'calendar' ? (
          <CalendarView settings={settings} initialDateIso={navDateIso} />
        ) : (
          <NotesView initialNoteId={navNoteId} />
        )}
      </main>
      </div>
      {undoToast ? (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 'var(--sp-5)', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--text-1)', color: 'var(--bg)', padding: 'var(--sp-2) var(--sp-4)',
            borderRadius: 'var(--radius-ctl)', fontSize: 'var(--fs-body)', boxShadow: 'var(--shadow-card)', zIndex: 100,
          }}
        >
          {undoToast}
        </div>
      ) : null}
      {helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}
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
