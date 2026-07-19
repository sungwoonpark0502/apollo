import React, { useEffect, useRef, useState } from 'react';
import { deleteNote, listNotes, saveNote, type WebNoteDto } from './api';

/**
 * Web notes: same two-pane shape as the desktop (list left, editor right),
 * stored on the account so they follow the user to any browser. Plain-text
 * v1 — the desktop's rich editor comes with sync (HUMAN_TODO).
 */
export function NotesView(): React.JSX.Element {
  const [notes, setNotes] = useState<WebNoteDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void listNotes().then((n) => {
      setNotes(n);
      setSelected(n[0]?.id ?? null);
    });
  }, []);

  if (notes === null) return <Center>…</Center>;
  const active = notes.find((n) => n.id === selected) ?? null;

  const mutate = (next: WebNoteDto): void => {
    setNotes((ns) => (ns ?? []).map((n) => (n.id === next.id ? next : n)));
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    // Same autosave rhythm as the desktop editor: an 800ms debounce.
    timer.current = setTimeout(() => {
      void saveNote({ id: next.id, title: next.title, content: next.content, pinned: next.pinned }).then((ok) =>
        setSaveState(ok ? 'saved' : 'idle'),
      );
    }, 800);
  };

  const create = (): void => {
    const note: WebNoteDto = { id: crypto.randomUUID(), title: '', content: '', pinned: false, updatedAt: Date.now() };
    setNotes((ns) => [note, ...(ns ?? [])]);
    setSelected(note.id);
    void saveNote(note);
  };

  const remove = (id: string): void => {
    setNotes((ns) => (ns ?? []).filter((n) => n.id !== id));
    if (selected === id) setSelected(null);
    void deleteNote(id);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', padding: 'var(--sp-3)', overflowY: 'auto' }}>
        <button onClick={create} style={primaryGhost}>New note</button>
        {notes.length === 0 ? <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)' }}>No notes yet.</p> : null}
        {notes.map((n) => (
          <button
            key={n.id}
            onClick={() => setSelected(n.id)}
            style={{ ...rowBtn, background: n.id === selected ? 'var(--accent-soft)' : 'transparent' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {n.pinned ? <span style={{ color: 'var(--accent)' }}>●</span> : null}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || firstLine(n.content) || 'Untitled'}</span>
            </span>
          </button>
        ))}
      </aside>

      {active ? (
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
            <input
              value={active.title}
              onChange={(e) => mutate({ ...active, title: e.target.value.slice(0, 200) })}
              placeholder="Untitled"
              aria-label="Note title"
              style={titleInput}
            />
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', minWidth: 48, textAlign: 'right' }}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
            </span>
            <button onClick={() => mutate({ ...active, pinned: !active.pinned })} style={toolBtn}>
              {active.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button onClick={() => remove(active.id)} style={{ ...toolBtn, color: 'var(--danger)' }}>
              Delete
            </button>
          </div>
          <textarea
            value={active.content}
            onChange={(e) => mutate({ ...active, content: e.target.value.slice(0, 100_000) })}
            placeholder="Write anything…"
            style={editor}
          />
        </main>
      ) : (
        <Center>Select a note, or create one.</Center>
      )}
    </div>
  );
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim())?.slice(0, 60) ?? '';
}

function Center({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ flex: 1, display: 'grid', placeContent: 'center', color: 'var(--text-3)' }}>{children}</div>;
}

const primaryGhost: React.CSSProperties = {
  width: '100%', marginBottom: 'var(--sp-3)', border: '1px dashed var(--border)', background: 'transparent',
  color: 'var(--accent)', borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2)', cursor: 'pointer',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const rowBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
  padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)', color: 'var(--text-1)',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const titleInput: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', background: 'transparent',
  fontSize: 'var(--fs-display)', fontWeight: 600, color: 'var(--text-1)', fontFamily: 'var(--font-sans)',
};
const toolBtn: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-1) var(--sp-2)', cursor: 'pointer',
  fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
const editor: React.CSSProperties = {
  flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  background: 'var(--surface)', color: 'var(--text-1)', padding: 'var(--sp-3)',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', lineHeight: 1.6, outline: 'none',
};
