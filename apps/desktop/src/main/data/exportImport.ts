import AdmZip from 'adm-zip';
import { DateTime } from 'luxon';
import { icsDate as icsDateKey, icsDateTime, type Settings } from '@apollo/shared';
import { type Repos } from '../db/repos/index';
import { type EventRow } from '../db/repos/events';

/**
 * H2 export/import. Export writes a zip: notes/*.md, calendar.ics, todos.json,
 * reminders.json, facts.json, settings.json (NEVER secrets/oauth tokens), and
 * optionally conversations.jsonl. Import merges by id (existing ids skipped).
 */
export interface ExportCounts { notes: number; events: number; todos: number; reminders: number; facts: number; conversations: number }
export interface ImportCounts { notes: number; events: number; todos: number; reminders: number; facts: number }

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'note';
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(ms: number, tz: string, allDay: boolean): string {
  return allDay ? `;VALUE=DATE:${icsDateKey(ms, tz)}` : `;TZID=${tz}:${icsDateTime(ms, tz)}`;
}

export function buildIcs(events: EventRow[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apollo//EN', 'CALSCALE:GREGORIAN'];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@apollo`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    lines.push(`DTSTART${icsDate(ev.startTs, ev.tz, ev.allDay)}`);
    if (ev.endTs) lines.push(`DTEND${icsDate(ev.endTs, ev.tz, ev.allDay)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule.replace(/^RRULE:/, '')}`);
    for (const d of ev.exdates ?? []) lines.push(`EXDATE;VALUE=DATE:${d.replace(/-/g, '')}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${icsEscape(ev.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function icsUnescape(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Minimal ICS → event rows parser (round-trips buildIcs output). */
export function parseIcs(ics: string): EventRow[] {
  const out: EventRow[] = [];
  const blocks = ics.split(/BEGIN:VEVENT/).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/)[0] ?? '';
    const get = (re: RegExp): string | null => body.match(re)?.[1]?.trim() ?? null;
    const uid = get(/UID:(.+)/);
    if (!uid) continue;
    const id = uid.replace(/@apollo\s*$/, '');
    const title = icsUnescape(get(/SUMMARY:(.+)/) ?? 'Untitled');
    const startM = body.match(/DTSTART(?:;VALUE=DATE|;TZID=([^:]+))?:(\S+)/);
    const endM = body.match(/DTEND(?:;VALUE=DATE|;TZID=([^:]+))?:(\S+)/);
    if (!startM) continue;
    const allDay = /DTSTART;VALUE=DATE:/.test(body);
    const tz = startM[1] ?? 'UTC';
    const parse = (raw: string): number =>
      allDay
        ? DateTime.fromFormat(raw, 'yyyyLLdd', { zone: tz }).toMillis()
        : DateTime.fromFormat(raw, "yyyyLLdd'T'HHmmss", { zone: tz }).toMillis();
    const startTs = parse(startM[2] as string);
    const endTs = endM ? parse(endM[2] as string) : null;
    const rrule = get(/RRULE:(.+)/);
    const exdates = [...body.matchAll(/EXDATE;VALUE=DATE:(\d{8})/g)].map((m) => {
      const d = m[1] as string;
      return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    });
    out.push({
      id, title, startTs, endTs, tz, allDay, rrule: rrule ? `RRULE:${rrule}`.replace(/^RRULE:RRULE:/, 'RRULE:') : null,
      exdates, location: icsUnescape(get(/LOCATION:(.+)/) ?? '') || null, notes: icsUnescape(get(/DESCRIPTION:(.+)/) ?? '') || null,
      reminderMin: null, calendarId: 'default', remoteId: null, etag: null, syncStatus: null,
      createdAt: 0, updatedAt: 0, deletedAt: null,
    });
  }
  return out;
}

export function exportZip(repos: Repos, settings: Settings, opts: { includeConversations: boolean }): { buffer: Buffer; counts: ExportCounts } {
  const zip = new AdmZip();
  const notes = repos.notes.allFull();
  const used = new Set<string>();
  for (const n of notes) {
    const title = n.content.split('\n').map((l) => l.trim()).find((l) => l) ?? 'note';
    let name = `${slug(title)}__${n.id}.md`;
    while (used.has(name)) name = `${slug(title)}-x__${n.id}.md`;
    used.add(name);
    zip.addFile(`notes/${name}`, Buffer.from(n.content, 'utf8'));
  }

  const events = repos.events.allActive();
  zip.addFile('calendar.ics', Buffer.from(buildIcs(events), 'utf8'));

  const todos = repos.todos.allActive();
  const reminders = repos.reminders.allActive();
  const facts = repos.memory.list();
  zip.addFile('todos.json', Buffer.from(JSON.stringify(todos, null, 2), 'utf8'));
  zip.addFile('reminders.json', Buffer.from(JSON.stringify(reminders, null, 2), 'utf8'));
  zip.addFile('facts.json', Buffer.from(JSON.stringify(facts, null, 2), 'utf8'));

  // settings.json — the Settings object holds no secrets; keys/tokens live only in
  // the encrypted `settings` table via security/secrets.ts, never in this object.
  zip.addFile('settings.json', Buffer.from(JSON.stringify(settings, null, 2), 'utf8'));

  let conversations = 0;
  if (opts.includeConversations) {
    const rows = repos.conversations.recentAll(50_000);
    conversations = rows.length;
    const jsonl = rows.map((m) => JSON.stringify({ convId: m.convId, role: m.role, content: m.content, ts: m.ts })).join('\n');
    zip.addFile('conversations.jsonl', Buffer.from(jsonl, 'utf8'));
  }

  return {
    buffer: zip.toBuffer(),
    counts: { notes: notes.length, events: events.length, todos: todos.length, reminders: reminders.length, facts: facts.length, conversations },
  };
}

export function importZip(repos: Repos, buffer: Buffer): ImportCounts {
  const zip = new AdmZip(buffer);
  const counts: ImportCounts = { notes: 0, events: 0, todos: 0, reminders: 0, facts: 0 };
  const readJson = <T,>(name: string): T[] => {
    const e = zip.getEntry(name);
    if (!e) return [];
    try {
      return JSON.parse(e.getData().toString('utf8')) as T[];
    } catch {
      return [];
    }
  };

  for (const entry of zip.getEntries()) {
    const m = entry.entryName.match(/^notes\/.+__([0-9a-fA-F-]+)\.md$/);
    if (m && !entry.isDirectory) {
      if (repos.notes.importRow({ id: m[1] as string, content: entry.getData().toString('utf8') })) counts.notes++;
    }
  }

  const icsEntry = zip.getEntry('calendar.ics');
  if (icsEntry) {
    for (const ev of parseIcs(icsEntry.getData().toString('utf8'))) {
      if (repos.events.importRow(ev)) counts.events++;
    }
  }

  for (const t of readJson<{ id: string; content: string; dueTs: number | null; done: boolean; createdAt: number; updatedAt: number }>('todos.json')) {
    if (repos.todos.importRow(t)) counts.todos++;
  }
  for (const r of readJson<{ id: string; text: string; dueTs: number; rrule: string | null; done: boolean; createdAt: number; updatedAt: number }>('reminders.json')) {
    if (repos.reminders.importRow(r)) counts.reminders++;
  }
  for (const f of readJson<{ id: string; category: string; fact: string; confidence: number; updatedAt: number }>('facts.json')) {
    if (repos.memory.importRow(f)) counts.facts++;
  }
  return counts;
}
