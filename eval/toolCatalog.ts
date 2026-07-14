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
import { createCalendarTools } from '../apps/desktop/src/main/tools/calendar';
import { createReminderTools } from '../apps/desktop/src/main/tools/reminder';
import { createNewsTool } from '../apps/desktop/src/main/tools/news';
import { createFilesTool } from '../apps/desktop/src/main/tools/files';
import { createSystemTools } from '../apps/desktop/src/main/tools/system';

export interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

/** Stub defs for tools whose real implementations land in later phases (C7 signatures). */
function futureToolDefs(): ToolDef[] {
  const defs: Array<{ name: string; tier: 1 | 2 | 3; networked?: boolean; description: string; params: z.ZodType }> = [
    { name: 'email.list', tier: 1, networked: true, description: 'List recent emails (subject, sender, snippet).', params: z.object({ query: z.string().optional(), max: z.number().int().max(20).optional() }) },
    { name: 'email.read', tier: 1, networked: true, description: 'Read one email by id.', params: z.object({ id: z.string() }) },
    { name: 'email.search', tier: 1, networked: true, description: 'Search the mailbox.', params: z.object({ query: z.string().min(1) }) },
    { name: 'email.draft', tier: 2, description: 'Compose a draft (to/subject/body) and show it to the user. Does not send.', params: z.object({ to: z.array(z.string()), subject: z.string(), body: z.string() }) },
    { name: 'email.send', tier: 3, networked: true, description: 'Send an email. Requires user confirmation. Every recipient must come from contact.find or be stated by the user.', params: z.object({ to: z.array(z.string()), subject: z.string(), body: z.string() }) },
    { name: 'screen.context', tier: 1, description: 'Active window title and selected text.', params: z.object({}) },
    { name: 'brief.daily', tier: 1, networked: true, description: 'Compose the daily brief: today\'s calendar, email triage, weather, news.', params: z.object({}) },
    {
      name: 'app.open',
      tier: 2,
      description:
        'Open or focus the Apollo Workspace window at a view. Use ONLY for explicit open/show/pull-up requests ("open my calendar", "show my notes", "pull up today"). Do NOT use for informational questions like "what\'s on my calendar" — those use calendar.list and never open a window. view is today, calendar, or notes.',
      params: z.object({ view: z.enum(['today', 'calendar', 'notes']), dateIso: z.string().optional(), noteId: z.string().optional() }),
    },
    {
      name: 'proactive.configure',
      tier: 2,
      description:
        'Turn a proactive nudge rule on or off, or "all" for every nudge. Use for "stop reminding me about meetings" (meeting_lead, false) or "stop all nudges" (all, false). Rule ids: meeting_lead, tomorrow_preview, overdue_todos, needs_reply, weather_heads_up.',
      params: z.object({ ruleId: z.enum(['meeting_lead', 'tomorrow_preview', 'overdue_todos', 'needs_reply', 'weather_heads_up', 'all']), enabled: z.boolean() }),
    },
    {
      name: 'proactive.status',
      tier: 1,
      description: 'Report which proactive nudges are on and how much of today\'s nudge budget remains. Use for "what nudges are on" or "why did you ping me".',
      params: z.object({}),
    },
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
    case 'app.open':
      return { llmText: `Opened ${String(args['view'] ?? '')}.` };
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
    ...createCalendarTools({ events: repos.events, undo: repos.undo }),
    ...createReminderTools({ reminders: repos.reminders, undo: repos.undo }),
    createNewsTool({ http: noHttp, feeds: repos.feeds }),
    createFilesTool({ getApprovedDirs: () => [] }),
    ...createSystemTools({
      platform: 'darwin',
      run: async () => ({ code: 0, stdout: '' }),
      openPath: async () => '',
      listAppDirs: () => [],
    }),
    ...createWeatherTools({ http: noHttp, getHome: () => ({ label: 'Home', lat: 0, lon: 0, tz: 'America/Los_Angeles' }), getUnits: () => 'imperial' }),
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
