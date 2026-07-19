import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EMPTY_DOC, STRINGS, type NoteDoc } from '@apollo/shared';

/**
 * L4 note editor. A deliberately small block/mark set — headings H1-H3,
 * paragraph, bold/italic/inline code, bullet/ordered/task lists, blockquote,
 * code block, divider, and a simple table. No colors, fonts, images, or
 * embeds (L4.2). Markdown-style input rules come from StarterKit; a slash menu
 * and a selection toolbar cover the same set for discoverability.
 *
 * The component owns no persistence policy: it reports doc changes upward and
 * NotesView keeps the E3.3 autosave semantics (debounce + blur + close).
 */
export interface NoteEditorProps {
  doc: NoteDoc;
  /** Fired on every change; the caller debounces and persists. */
  onChange: (doc: NoteDoc) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
}

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // Excluded by L4.2: no images or embeds ship with StarterKit anyway.
    link: false, // configured separately below so we control the attributes
  }),
  TaskList,
  TaskItem.configure({ nested: false }),
  Table.configure({ resizable: false }), // simple tables only: no cell merging
  TableRow,
  TableHeader,
  TableCell,
  Link.configure({ openOnClick: false, autolink: true }),
  Placeholder.configure({ placeholder: STRINGS.workspace.notes.editorPlaceholder }),
];

interface BlockCommand {
  id: string;
  label: string;
  run: (e: Editor) => void;
}

/** The single source for both the slash menu and the shortcuts help sheet. */
export const BLOCK_COMMANDS: BlockCommand[] = [
  { id: 'h1', label: 'Heading 1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'bullet', label: 'Bulleted list', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: 'Checklist', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: 'Quote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Code block', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'divider', label: 'Divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'table', label: 'Table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

export function NoteEditor({ doc, onChange, onBlur, autoFocus }: NoteEditorProps): React.JSX.Element {
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [selectionToolbar, setSelectionToolbar] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedIdRef = useRef<NoteDoc | null>(null);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: doc ?? EMPTY_DOC,
    autofocus: autoFocus ?? false,
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as NoteDoc),
    onBlur: () => {
      setSelectionToolbar(false);
      onBlur?.();
    },
    onSelectionUpdate: ({ editor: e }) => {
      setSelectionToolbar(!e.state.selection.empty);
    },
  });

  // Swap content when the caller opens a different note. Comparing the object
  // identity is enough: NotesView hands us a fresh doc per note load.
  useEffect(() => {
    if (!editor || loadedIdRef.current === doc) return;
    loadedIdRef.current = doc;
    editor.commands.setContent(doc ?? EMPTY_DOC, { emitUpdate: false });
  }, [editor, doc]);

  const filtered = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    return q ? BLOCK_COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : BLOCK_COMMANDS;
  }, [slashQuery]);

  if (!editor) return <div style={{ color: 'var(--text-3)' }}>…</div>;

  const onKeyDown = (ev: React.KeyboardEvent): void => {
    if (slashOpen) {
      if (ev.key === 'Escape') {
        setSlashOpen(false);
        setSlashQuery('');
        ev.preventDefault();
      } else if (ev.key === 'Enter') {
        const first = filtered[0];
        if (first) {
          runCommand(first);
          ev.preventDefault();
        }
      } else if (ev.key === 'Backspace' && slashQuery === '') {
        setSlashOpen(false);
      } else if (ev.key.length === 1) {
        setSlashQuery((q) => q + ev.key);
      }
      return;
    }
    // "/" at the start of an empty block opens the block menu (L4.3).
    if (ev.key === '/' && editor.state.selection.empty && editor.state.selection.$from.parent.content.size === 0) {
      setSlashOpen(true);
      setSlashQuery('');
    }
  };

  const runCommand = (cmd: BlockCommand): void => {
    // Remove the "/query" the user typed before applying the block.
    const drop = slashQuery.length + 1;
    if (drop > 0) {
      const to = editor.state.selection.from;
      editor.chain().focus().deleteRange({ from: Math.max(0, to - drop), to }).run();
    }
    cmd.run(editor);
    setSlashOpen(false);
    setSlashQuery('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} onKeyDown={onKeyDown}>
      {selectionToolbar ? <SelectionToolbar editor={editor} /> : null}
      <EditorContent editor={editor} className="apollo-prose" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} />
      {slashOpen ? (
        <div role="listbox" aria-label={STRINGS.workspace.notes.blockMenu} style={slashMenuStyle}>
          <div style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
            {slashQuery ? `/${slashQuery}` : STRINGS.workspace.notes.blockMenu}
          </div>
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              role="option"
              aria-selected={i === 0}
              onMouseDown={(e) => {
                e.preventDefault();
                runCommand(cmd);
              }}
              style={{ ...slashItemStyle, background: i === 0 ? 'var(--accent-soft)' : 'transparent' }}
            >
              {cmd.label}
            </button>
          ))}
          {filtered.length === 0 ? (
            <div style={{ ...slashItemStyle, color: 'var(--text-3)' }}>{STRINGS.workspace.notes.blockMenuEmpty}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** L4.3 hovering toolbar on a text selection: bold/italic/code/link/list. */
function SelectionToolbar({ editor }: { editor: Editor }): React.JSX.Element {
  const btn = (label: string, active: boolean, run: () => void): React.JSX.Element => (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
      aria-pressed={active}
      style={{ ...toolbarBtn, color: active ? 'var(--accent)' : 'var(--text-2)' }}
    >
      {label}
    </button>
  );
  return (
    <div style={toolbarStyle}>
      {btn('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
      {btn('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
      {btn('<>', editor.isActive('code'), () => editor.chain().focus().toggleCode().run())}
      {btn('•', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
      {btn('☑', editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run())}
    </div>
  );
}

const slashMenuStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'var(--sp-3)', left: 'var(--sp-3)', zIndex: 30, minWidth: 200,
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column', maxHeight: 280, overflowY: 'auto',
};

const slashItemStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer',
  padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', color: 'var(--text-1)',
};

const toolbarStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, zIndex: 20, display: 'flex', gap: 2,
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  boxShadow: 'var(--shadow-card)', padding: 2,
};

const toolbarBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer', minWidth: 26, height: 24,
  fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
