/**
 * L4 note documents. Notes are stored as a portable ProseMirror/TipTap JSON
 * document plus a derived plain-text mirror. The mirror is what FTS, the
 * embedding chunker, title/snippet derivation, and recall all consume, so
 * every existing consumer keeps working unchanged.
 *
 * All conversions live here as pure functions — no TipTap runtime, no DOM — so
 * the doc↔text and doc↔markdown behavior is unit-testable and the editor
 * component stays a thin shell over them.
 *
 * Deliberately small block/mark set (L4.2): headings H1-H3, paragraph, bold,
 * italic, inline code, bullet/ordered/task lists, blockquote, code block,
 * horizontal rule, and a simple table. No colors, fonts, images, or embeds.
 */

export type MarkType = 'bold' | 'italic' | 'code' | 'link';

export interface DocMark {
  type: MarkType;
  attrs?: { href?: string };
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

export interface NoteDoc {
  type: 'doc';
  content: DocNode[];
}

export const EMPTY_DOC: NoteDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The block/mark names the editor is allowed to produce (L4.2). */
export const ALLOWED_NODES = [
  'doc', 'paragraph', 'heading', 'text', 'hardBreak',
  'bulletList', 'orderedList', 'listItem',
  'taskList', 'taskItem',
  'blockquote', 'codeBlock', 'horizontalRule',
  'table', 'tableRow', 'tableHeader', 'tableCell',
] as const;
export const ALLOWED_MARKS: MarkType[] = ['bold', 'italic', 'code', 'link'];

// ---- text projection (FTS, chunking/embedding, title/snippet) ----

function inlineText(nodes: DocNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.text ?? '';
      if (n.type === 'hardBreak') return '\n';
      return inlineText(n.content);
    })
    .join('');
}

/**
 * The plain-text mirror. Checklist item text and table cell text ARE included
 * so search and recall still find them (L4.5).
 */
export function docToPlainText(doc: NoteDoc): string {
  const lines: string[] = [];

  const walk = (node: DocNode, listPrefix?: string): void => {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        lines.push((listPrefix ?? '') + inlineText(node.content));
        return;
      case 'blockquote':
        for (const child of node.content ?? []) walk(child);
        return;
      case 'codeBlock':
        lines.push(inlineText(node.content));
        return;
      case 'horizontalRule':
        return;
      case 'bulletList':
      case 'orderedList':
        for (const item of node.content ?? []) {
          for (const child of item.content ?? []) walk(child);
        }
        return;
      case 'taskList':
        for (const item of node.content ?? []) {
          for (const child of item.content ?? []) walk(child);
        }
        return;
      case 'table':
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((cell) => inlineText(cell.content?.flatMap((b) => b.content ?? [])));
          lines.push(cells.filter(Boolean).join(' '));
        }
        return;
      default:
        for (const child of node.content ?? []) walk(child);
    }
  };

  for (const node of doc.content ?? []) walk(node);
  // Collapse the trailing blank lines an editor tends to leave behind.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

// ---- markdown export (H2 parity, from the doc so structure survives) ----

function inlineMarkdown(nodes: DocNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '\n';
      if (n.type !== 'text') return inlineMarkdown(n.content);
      let out = n.text ?? '';
      // Innermost first so nesting reads naturally: ***bold italic***.
      for (const mark of n.marks ?? []) {
        if (mark.type === 'code') out = `\`${out}\``;
        else if (mark.type === 'bold') out = `**${out}**`;
        else if (mark.type === 'italic') out = `*${out}*`;
        else if (mark.type === 'link') out = `[${out}](${mark.attrs?.href ?? ''})`;
      }
      return out;
    })
    .join('');
}

export function docToMarkdown(doc: NoteDoc): string {
  const blocks: string[] = [];

  const render = (node: DocNode, indent = ''): string[] => {
    switch (node.type) {
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.['level'] ?? 1)));
        return [`${'#'.repeat(level)} ${inlineMarkdown(node.content)}`];
      }
      case 'paragraph':
        return [indent + inlineMarkdown(node.content)];
      case 'blockquote':
        return (node.content ?? []).flatMap((c) => render(c)).map((l) => `> ${l}`);
      case 'codeBlock': {
        const lang = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : '';
        return ['```' + lang, inlineText(node.content), '```'];
      }
      case 'horizontalRule':
        return ['---'];
      case 'bulletList':
        return (node.content ?? []).flatMap((item) => {
          const inner = (item.content ?? []).flatMap((c) => render(c));
          return inner.map((l, i) => (i === 0 ? `${indent}- ${l.trim()}` : `${indent}  ${l.trim()}`));
        });
      case 'orderedList':
        return (node.content ?? []).flatMap((item, idx) => {
          const inner = (item.content ?? []).flatMap((c) => render(c));
          return inner.map((l, i) => (i === 0 ? `${indent}${idx + 1}. ${l.trim()}` : `${indent}   ${l.trim()}`));
        });
      case 'taskList':
        return (node.content ?? []).flatMap((item) => {
          const checked = item.attrs?.['checked'] === true;
          const inner = (item.content ?? []).flatMap((c) => render(c));
          return inner.map((l, i) => (i === 0 ? `${indent}- [${checked ? 'x' : ' '}] ${l.trim()}` : `${indent}  ${l.trim()}`));
        });
      case 'table': {
        const rows = node.content ?? [];
        if (rows.length === 0) return [];
        const cellText = (row: DocNode): string[] =>
          (row.content ?? []).map((cell) => (cell.content ?? []).map((b) => inlineMarkdown(b.content)).join(' ').trim());
        const header = cellText(rows[0]!);
        const out = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
        for (const row of rows.slice(1)) out.push(`| ${cellText(row).join(' | ')} |`);
        return out;
      }
      default:
        return (node.content ?? []).flatMap((c) => render(c));
    }
  };

  for (const node of doc.content ?? []) {
    const rendered = render(node);
    if (rendered.length > 0) blocks.push(rendered.join('\n'));
  }
  return blocks.join('\n\n').replace(/\s+$/, '');
}

// ---- plain text → doc (migration, and any legacy write path) ----

const TASK_LINE = /^\s*-\s*\[([ xX])\]\s*(.*)$/;
const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const ORDERED_LINE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_LINE = /^(#{1,3})\s+(.*)$/;

function textNode(text: string): DocNode[] {
  return text ? [{ type: 'text', text }] : [];
}

/**
 * Wraps plain text into a doc. Markdown-ish task/bullet/ordered/heading lines
 * are recognized so the 0008 To-dos migration (which wrote "- [ ] item" lines)
 * comes through as real checklist items rather than dead text.
 */
export function plainTextToDoc(text: string): NoteDoc {
  const lines = text.split('\n');
  const content: DocNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const task = TASK_LINE.exec(line);
    if (task) {
      const items: DocNode[] = [];
      while (i < lines.length) {
        const m = TASK_LINE.exec(lines[i]!);
        if (!m) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: m[1]!.toLowerCase() === 'x' },
          content: [{ type: 'paragraph', content: textNode(m[2]!.trim()) }],
        });
        i += 1;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      const items: DocNode[] = [];
      while (i < lines.length) {
        if (TASK_LINE.test(lines[i]!)) break; // a task line is its own list
        const m = BULLET_LINE.exec(lines[i]!);
        if (!m) break;
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: textNode(m[1]!.trim()) }] });
        i += 1;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    const ordered = ORDERED_LINE.exec(line);
    if (ordered) {
      const items: DocNode[] = [];
      while (i < lines.length) {
        const m = ORDERED_LINE.exec(lines[i]!);
        if (!m) break;
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: textNode(m[1]!.trim()) }] });
        i += 1;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    const heading = HEADING_LINE.exec(line);
    if (heading) {
      content.push({ type: 'heading', attrs: { level: heading[1]!.length }, content: textNode(heading[2]!.trim()) });
      i += 1;
      continue;
    }

    content.push({ type: 'paragraph', content: textNode(line) });
    i += 1;
  }

  return { type: 'doc', content: content.length > 0 ? content : EMPTY_DOC.content };
}

/** Parses stored doc JSON, falling back to wrapping the mirror when absent/corrupt. */
export function parseDoc(docJson: string | null, plainFallback: string): NoteDoc {
  if (docJson) {
    try {
      const parsed = JSON.parse(docJson) as NoteDoc;
      if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) return parsed;
    } catch {
      /* corrupt doc: fall back to the mirror below */
    }
  }
  return plainTextToDoc(plainFallback);
}

// ---- checklist helpers (L4.4, the sanctioned todo replacement) ----

/** Appends a checklist item, reusing a trailing task list when there is one. */
export function appendChecklistItemToDoc(doc: NoteDoc, text: string): NoteDoc {
  const item: DocNode = {
    type: 'taskItem',
    attrs: { checked: false },
    content: [{ type: 'paragraph', content: textNode(text.trim()) }],
  };
  const content = [...(doc.content ?? [])];
  // Drop a trailing empty paragraph so the item does not land after a blank line.
  while (content.length > 0) {
    const last = content[content.length - 1]!;
    if (last.type === 'paragraph' && inlineText(last.content).trim() === '') content.pop();
    else break;
  }
  const last = content[content.length - 1];
  if (last?.type === 'taskList') {
    content[content.length - 1] = { ...last, content: [...(last.content ?? []), item] };
  } else {
    content.push({ type: 'taskList', content: [item] });
  }
  return { type: 'doc', content };
}

/** Every checklist item in the doc, in order. */
export function readChecklistFromDoc(doc: NoteDoc): Array<{ checked: boolean; text: string }> {
  const out: Array<{ checked: boolean; text: string }> = [];
  const walk = (node: DocNode): void => {
    if (node.type === 'taskItem') {
      out.push({ checked: node.attrs?.['checked'] === true, text: inlineText(node.content?.flatMap((c) => c.content ?? [])) });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of doc.content ?? []) walk(node);
  return out;
}

/** Title = first non-empty projected line, matching the pre-L4 derivation. */
export function docTitle(doc: NoteDoc): string {
  const first = docToPlainText(doc).split('\n').find((l) => l.trim().length > 0);
  return (first ?? '').trim().slice(0, 80);
}

/**
 * L4.4 title/body split. The note title stays the document's first block rather
 * than a new column, so there is still exactly one source of truth: the title
 * remains part of the doc, which means FTS, the chunker, recall, markdown
 * export, and `docTitle` keep working with no migration and no second field to
 * hold in sync.
 *
 * The editor renders the title in its own input and the rest below it; these
 * two functions are the seam. `joinTitle(splitTitle(d))` round-trips.
 */
export function splitTitle(doc: NoteDoc): { title: string; body: NoteDoc } {
  const blocks = doc.content ?? [];
  const first = blocks[0];
  // Only a heading or a paragraph acts as the title. A note that opens with a
  // list or a table has no title line to steal, so the body stays whole.
  const isTitleBlock = first !== undefined && (first.type === 'heading' || first.type === 'paragraph');
  if (!isTitleBlock) return { title: '', body: doc };
  const title = nodeText(first).trim();
  const rest = blocks.slice(1);
  return { title, body: { type: 'doc', content: rest.length > 0 ? rest : [{ type: 'paragraph' }] } };
}

export function joinTitle(title: string, body: NoteDoc): NoteDoc {
  const head: DocNode = {
    type: 'heading',
    attrs: { level: 1 },
    ...(title.length > 0 ? { content: [{ type: 'text', text: title }] } : {}),
  };
  const rest = body.content ?? [];
  // An empty title still occupies the first block, or typing one later would
  // silently promote the first body paragraph into the title.
  return { type: 'doc', content: [head, ...rest] };
}

/** Flattened text of a single node, including its descendants. */
function nodeText(node: DocNode): string {
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}
