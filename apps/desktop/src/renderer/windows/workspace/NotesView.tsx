import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtRelative, STRINGS, type NoteListItem } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { debounce, wordCount } from '../../lib/debounce';

type SaveState = 'idle' | 'saving' | 'saved';

export function NotesView({ initialNoteId }: { initialNoteId?: string }): React.JSX.Element {
  const n = STRINGS.workspace.notes;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId ?? null);
  const searchRef = useRef<HTMLInputElement>(null);

  // FTS as-you-type, 200ms debounce (E3.3)
  const searchDebounce = useMemo(() => debounce((q: string) => setDebouncedQuery(q), 200), []);
  useEffect(() => {
    searchDebounce(query);
  }, [query, searchDebounce]);

  const { data: notes, reload } = useDataSync<NoteListItem[]>(['note'], () =>
    window.apollo.call('notes.list', { query: debouncedQuery || undefined, limit: 200 }),
  );

  // Re-run the search loader when the debounced query changes.
  useEffect(() => {
    reload();
  }, [debouncedQuery, reload]);

  // Cmd/Ctrl+F focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        searchRef.current?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [toast, setToast] = useState<{ noteId: string; undoToken: string } | null>(null);

  const pinned = (notes ?? []).filter((x) => x.pinned);
  const unpinned = (notes ?? []).filter((x) => !x.pinned);

  const createNote = (): void => {
    void window.apollo.call('notes.save', { content: '' }).then((saved) => {
      setSelectedId(saved.id);
      reload();
    });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={n.searchPlaceholder}
            style={searchInput}
          />
          <button onClick={createNote} style={{ ...newBtn, marginTop: 'var(--sp-2)' }}>{n.newNote}</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--sp-2)' }}>
          {(notes ?? []).length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body)', padding: 'var(--sp-3)' }}>{n.empty}</div>
          ) : (
            <>
              {pinned.length > 0 ? (
                <>
                  <SectionLabel text={n.pinned} />
                  {pinned.map((note) => (
                    <NoteRow key={note.id} note={note} active={note.id === selectedId} onClick={() => setSelectedId(note.id)} />
                  ))}
                </>
              ) : null}
              {unpinned.map((note) => (
                <NoteRow key={note.id} note={note} active={note.id === selectedId} onClick={() => setSelectedId(note.id)} />
              ))}
            </>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, position: 'relative' }}>
        {selectedId ? (
          <NoteEditor
            key={selectedId}
            noteId={selectedId}
            onChanged={reload}
            onDeleted={(undoToken) => {
              setToast({ noteId: selectedId, undoToken });
              setSelectedId(null);
              reload();
            }}
          />
        ) : (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>{n.emptyEditor}</div>
        )}
      </main>

      {toast ? (
        <UndoToast
          onUndo={() => {
            void window.apollo.call('undo.apply', { undoToken: toast.undoToken }).then(() => {
              setSelectedId(toast.noteId);
              setToast(null);
              reload();
            });
          }}
          onExpire={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

function NoteEditor({ noteId, onChanged, onDeleted }: { noteId: string; onChanged: () => void; onDeleted: (undoToken: string) => void }): React.JSX.Element {
  const n = STRINGS.workspace.notes;
  const [content, setContent] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    let alive = true;
    void window.apollo.call('notes.get', { id: noteId }).then((note) => {
      if (alive) {
        setContent(note.content);
        setPinned(note.pinned);
      }
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  // Autosave: 800ms debounce + on blur + on unmount/window-close (E3.3)
  const save = useMemo(
    () =>
      debounce((text: string) => {
        setSaveState('saving');
        void window.apollo.call('notes.save', { id: noteId, content: text }).then(() => {
          setSaveState('saved');
          onChanged();
        });
      }, 800),
    [noteId, onChanged],
  );

  useEffect(() => {
    const flushNow = (): void => save.flush();
    window.addEventListener('beforeunload', flushNow);
    return () => {
      save.flush(); // on unmount (switching notes / closing)
      window.removeEventListener('beforeunload', flushNow);
    };
  }, [save]);

  if (content === null) return <div style={{ padding: 'var(--sp-6)', color: 'var(--text-3)' }}>…</div>;

  const onEdit = (text: string): void => {
    setContent(text);
    setSaveState('saving');
    save(text);
  };

  const togglePin = (): void => {
    const next = !pinned;
    setPinned(next);
    void window.apollo.call('notes.pin', { id: noteId, pinned: next }).then(onChanged);
  };

  const del = (): void => {
    save.cancel();
    void window.apollo.call('notes.delete', { id: noteId }).then((r) => onDeleted(r.undoToken));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--sp-2)', padding: 'var(--sp-3) var(--sp-4)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginRight: 'auto' }}>
          {saveState === 'saving' ? n.saving : saveState === 'saved' ? n.saved : ''}
        </span>
        <button onClick={togglePin} style={toolBtn}>{pinned ? n.unpin : n.pin}</button>
        <button onClick={del} style={{ ...toolBtn, color: 'var(--danger)' }}>{n.delete}</button>
      </div>
      <textarea
        autoFocus
        value={content}
        onChange={(e) => onEdit(e.target.value)}
        onBlur={() => save.flush()}
        placeholder={n.placeholder}
        style={editorArea}
      />
      <div style={{ padding: 'var(--sp-2) var(--sp-4)', borderTop: '1px solid var(--border)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
        {n.words(wordCount(content))}
      </div>
    </div>
  );
}

function UndoToast({ onUndo, onExpire }: { onUndo: () => void; onExpire: () => void }): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onExpire, 5000);
    return () => clearTimeout(t);
  }, [onExpire]);
  return (
    <div style={{ position: 'fixed', bottom: 'var(--sp-5)', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-4)', background: 'var(--text-1)', color: 'var(--bg)', borderRadius: 'var(--radius-ctl)', boxShadow: 'var(--shadow-card)', zIndex: 200 }}>
      <span style={{ fontSize: 'var(--fs-body)' }}>{STRINGS.workspace.notes.deletedToast}</span>
      <button onClick={onUndo} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-body)' }}>
        {STRINGS.workspace.notes.undo}
      </button>
    </div>
  );
}

function NoteRow({ note, active, onClick }: { note: NoteListItem; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: 'var(--sp-2) var(--sp-3)', marginBottom: 2,
        borderRadius: 'var(--radius-ctl)', border: 'none', cursor: 'pointer',
        background: active ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {note.title || STRINGS.workspace.notes.untitled}
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {note.snippet || fmtRelative(note.updatedAt)}
      </div>
    </button>
  );
}

function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return <div style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-3)', padding: 'var(--sp-2) var(--sp-3) var(--sp-1)' }}>{text}</div>;
}

const searchInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const newBtn: React.CSSProperties = {
  width: '100%', padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const toolBtn: React.CSSProperties = {
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
const editorArea: React.CSSProperties = {
  flex: 1, width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', outline: 'none',
  padding: 'var(--sp-5)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', lineHeight: 1.7,
  background: 'var(--bg)', color: 'var(--text-1)',
};
