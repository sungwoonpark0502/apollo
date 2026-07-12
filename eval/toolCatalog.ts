import { z } from 'zod';
import type { ToolDef, ToolResult } from '@apollo/shared';
import { openDb } from '../apps/desktop/src/main/db/connection';
import { migrate } from '../apps/desktop/src/main/db/migrate';
import { createRepos } from '../apps/desktop/src/main/db/repos/index';
import { createTimerTools } from '../apps/desktop/src/main/tools/timer';
import { createAlarmTools } from '../apps/desktop/src/main/tools/alarm';
import { createNoteTools } from '../apps/desktop/src/main/tools/note';
import { createTodoTools } from '../apps/desktop/src/main/tools/todo';
import { createContactTools } from '../apps/desktop/src/main/tools/contact';
import { createMemoryTools } from '../apps/desktop/src/main/tools/memory';
import { createUndoTool } from '../apps/desktop/src/main/tools/undo';
import { createWeatherTools } from '../apps/desktop/src/main/tools/weather';
import { createSearchWebTool } from '../apps/desktop/src/main/tools/searchWeb';

export interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

/** Stub defs for tools whose real implementations land in later phases (C7 signatures). */
function futureToolDefs(): ToolDef[] {
  const defs: Array<{ name: string; tier: 1 | 2 | 3; networked?: boolean; description: string; params: z.ZodType }> = [
    {
      name: 'calendar.create', tier: 2,
      description: 'Create a calendar event. startIso/endIso are ISO 8601. tz "LOCAL" means the user\'s timezone. Use rrule (RFC 5545) for recurrence.',
      params: z.object({
        title: z.string().min(1), startIso: z.string(), endIso: z.string().optional(),
        tz: z.string().default('LOCAL'), rrule: z.string().optional(), allDay: z.boolean().optional(),
        location: z.string().optional(), reminderMin: z.number().int().min(0).optional(),
      }),
    },
    {
      name: 'calendar.update', tier: 2,
      description: 'Patch an event by id. For recurring events pass scope "single" (this occurrence only) or "all".',
      params: z.object({
        id: z.string(), scope: z.enum(['single', 'all']).optional(), occurrenceDateIso: z.string().optional(),
        title: z.string().optional(), startIso: z.string().optional(), endIso: z.string().optional(),
        location: z.string().optional(), rrule: z.string().optional(),
      }),
    },
    { name: 'calendar.delete', tier: 2, description: 'Delete an event by id (soft delete, undoable). Same scope semantics as update.', params: z.object({ id: z.string(), scope: z.enum(['single', 'all']).optional(), occurrenceDateIso: z.string().optional() }) },
    { name: 'calendar.list', tier: 1, description: 'List calendar occurrences in a date range (expands recurrence). Defaults to today when no range given.', params: z.object({ startIso: z.string().optional(), endIso: z.string().optional() }) },
    { name: 'calendar.search', tier: 1, description: 'Search events by title/location/notes.', params: z.object({ query: z.string().min(1) }) },
    { name: 'reminder.create', tier: 2, description: 'Create a reminder with text and a due time (ISO 8601 local). Use rrule for recurring reminders.', params: z.object({ text: z.string().min(1), dueIso: z.string(), rrule: z.string().optional() }) },
    { name: 'reminder.complete', tier: 2, description: 'Mark a reminder done by id or fuzzy text match.', params: z.object({ id: z.string().optional(), text: z.string().optional() }) },
    { name: 'reminder.snooze', tier: 2, description: 'Snooze a reminder by minutes (default 10).', params: z.object({ id: z.string().optional(), text: z.string().optional(), minutes: z.number().int().positive().default(10) }) },
    { name: 'reminder.list', tier: 1, description: 'List pending reminders.', params: z.object({}) },
    { name: 'news.brief', tier: 1, networked: true, description: 'Fetch and summarize the news from the user\'s feeds; optional category filter (e.g. "tech").', params: z.object({ category: z.string().optional() }) },
    { name: 'files.find', tier: 1, description: 'Find files by name substring in the user\'s approved folders; optional extension filter.', params: z.object({ query: z.string().min(1), extension: z.string().optional() }) },
    { name: 'system.openApp', tier: 2, description: 'Open an installed application by (fuzzy) name.', params: z.object({ name: z.string().min(1) }) },
    { name: 'system.volume', tier: 2, description: 'Set system volume: op "set" with value 0..100, or "up"/"down" (10-point steps).', params: z.object({ op: z.enum(['set', 'up', 'down']), value: z.number().int().min(0).max(100).optional() }) },
    { name: 'system.media', tier: 2, description: 'Media control: playpause, next, prev.', params: z.object({ op: z.enum(['playpause', 'next', 'prev']) }) },
    { name: 'system.screenshot', tier: 2, description: 'Capture the full screen to Pictures/Apollo.', params: z.object({}) },
    { name: 'system.lock', tier: 2, description: 'Lock the session.', params: z.object({}) },
    { name: 'email.list', tier: 1, networked: true, description: 'List recent emails (subject, sender, snippet).', params: z.object({ query: z.string().optional(), max: z.number().int().max(20).optional() }) },
    { name: 'email.read', tier: 1, networked: true, description: 'Read one email by id.', params: z.object({ id: z.string() }) },
    { name: 'email.search', tier: 1, networked: true, description: 'Search the mailbox.', params: z.object({ query: z.string().min(1) }) },
    { name: 'email.draft', tier: 2, description: 'Compose a draft (to/subject/body) and show it to the user. Does not send.', params: z.object({ to: z.array(z.string()), subject: z.string(), body: z.string() }) },
    { name: 'email.send', tier: 3, networked: true, description: 'Send an email. Requires user confirmation. Every recipient must come from contact.find or be stated by the user.', params: z.object({ to: z.array(z.string()), subject: z.string(), body: z.string() }) },
    { name: 'screen.context', tier: 1, description: 'Active window title and selected text.', params: z.object({}) },
    { name: 'brief.daily', tier: 1, networked: true, description: 'Compose the daily brief: today\'s calendar, email triage, weather, news.', params: z.object({}) },
  ];
  return defs.map((d) => ({
    ...d,
    async execute(): Promise<ToolResult> {
      return { llmText: 'ok' };
    },
  }));
}

/** Realistic canned results so multi-step conversations stay coherent. */
function cannedResult(name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case 'calendar.create':
      return { llmText: `Created "${String(args['title'] ?? 'event')}" ${String(args['startIso'] ?? '')}.` };
    case 'calendar.update':
      return { llmText: 'Updated the event.' };
    case 'calendar.delete':
      return { llmText: 'Deleted the event.' };
    case 'calendar.list':
      return { llmText: '2 events: 1. Standup Mon Jul 13, 9:30 AM (id ev_1); 2. Dentist Tue Jul 14, 3:00 PM (id ev_2).' };
    case 'calendar.search':
      return { llmText: `1 match for "${String(args['query'] ?? '')}": Dentist Tue Jul 14, 3:00 PM (id ev_2).` };
    case 'reminder.create':
      return { llmText: `Reminder set: "${String(args['text'] ?? '')}" at ${String(args['dueIso'] ?? '')}.` };
    case 'reminder.list':
      return { llmText: '1 pending reminder: take out the trash tonight at 9 PM (id rem_1).' };
    case 'timer.start':
      return { llmText: `Timer set for ${String(args['durationSec'])} seconds.` };
    case 'timer.cancel':
      return { llmText: 'Timer canceled.' };
    case 'timer.list':
      return { llmText: '1 timer running: "pasta", 6 minutes remaining (id tm_1).' };
    case 'alarm.set':
      return { llmText: `Alarm set for ${String(args['atIso'] ?? '')}${args['rrule'] ? ` repeating ${String(args['rrule'])}` : ''}.` };
    case 'note.save':
      return { llmText: 'Noted.' };
    case 'note.search':
      return { llmText: '1 note: "the garage code is 4831".' };
    case 'todo.add':
      return { llmText: 'Added to your list.' };
    case 'todo.list':
      return { llmText: 'Open todos: 1. buy milk' };
    case 'contact.find': {
      const q = String(args['name'] ?? '').toLowerCase();
      if (q.includes('jane')) return { llmText: 'Jane Doe <jane@example.com>' };
      if (q.includes('bob')) return { llmText: 'Bob Park <bob@work.com>' };
      return { llmText: `No contact matched "${q}".` };
    }
    case 'contact.add':
      return { llmText: 'Saved contact.' };
    case 'memory.save':
      return { llmText: `Remembered: ${String(args['fact'] ?? '')}` };
    case 'memory.forget':
      return { llmText: 'Forgot it.' };
    case 'weather.now':
      return { llmText: `Weather in ${String(args['place'] ?? 'Home')}: 88°F (feels 92), Sunny, wind 6, precip 5%.` };
    case 'weather.forecast':
      return { llmText: `Forecast for ${String(args['place'] ?? 'Home')}: Sat 90/70 Sunny 0%; Sun 91/71 Partly cloudy 10%; Mon 87/69 Rain 60%; Tue 85/66 Overcast 20%.` };
    case 'news.brief':
      return { llmText: '<headlines> 1. Markets rally on rate cut hopes (AP). 2. New battery tech doubles range (Verge). </headlines>', untrusted: true };
    case 'search.web':
      return {
        llmText: `1. Result about "${String(args['query'] ?? '')}" — helpful summary (https://example.com/a)\n2. Second result — more detail (https://example.com/b)`,
        untrusted: true,
      };
    case 'email.list':
      return { llmText: '2 emails: 1. From jane@example.com "Lunch?" (id em_1, unread); 2. From newsletter@shop.com "Sale" (id em_2).', untrusted: true };
    case 'email.read':
      return { llmText: 'From jane@example.com, subject "Lunch?": Want to grab lunch Friday at noon?', untrusted: true };
    case 'email.search':
      return { llmText: '1 result: from jane@example.com "Lunch?" (id em_1).', untrusted: true };
    case 'email.draft':
      return { llmText: `Draft ready to ${JSON.stringify(args['to'])}: "${String(args['subject'] ?? '')}".` };
    case 'email.send':
      return { llmText: `Sent email to ${JSON.stringify(args['to'])}.` };
    case 'system.openApp':
      return { llmText: `Opening ${String(args['name'] ?? '')}.` };
    case 'system.volume':
      return { llmText: 'Volume 60 percent.' };
    case 'undo.last':
      return { llmText: 'Undone: removed the event.' };
    default:
      return { llmText: 'ok' };
  }
}

/**
 * Full C7 tool surface with recording, canned executors: real defs where they
 * exist (schemas/descriptions the model actually sees), stubs for later phases.
 */
export function buildEvalTools(calls: RecordedCall[]): ToolDef[] {
  const db = openDb(':memory:');
  migrate(db);
  const repos = createRepos(db);
  const noHttp = { getJson: async (): Promise<unknown> => ({}), getText: async (): Promise<string> => '', postJson: async (): Promise<unknown> => ({}) };

  const real: ToolDef[] = [
    ...createTimerTools({ timers: repos.timers, undo: repos.undo }),
    ...createAlarmTools({ alarms: repos.alarms, undo: repos.undo }),
    ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
    ...createTodoTools({ todos: repos.todos, undo: repos.undo }),
    ...createContactTools({ contacts: repos.contacts, undo: repos.undo }),
    ...createMemoryTools({ memory: repos.memory, undo: repos.undo }),
    createUndoTool(repos),
    ...createWeatherTools({ http: noHttp, getHome: () => ({ name: 'Home', lat: 0, lon: 0 }), getUnits: () => 'imperial' }),
    createSearchWebTool({ http: noHttp, getBraveKey: () => 'eval' }),
  ];

  const all = [...real, ...futureToolDefs()];
  return all.map((t) => ({
    ...t,
    async execute(args: unknown): Promise<ToolResult> {
      const a = (args ?? {}) as Record<string, unknown>;
      calls.push({ name: t.name, args: a });
      return cannedResult(t.name, a);
    },
  })) as ToolDef[];
}
