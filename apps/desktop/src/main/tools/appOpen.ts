import { z } from 'zod';
import { STRINGS, type ToolDef } from '@apollo/shared';

/**
 * E8 app.open (Tier 2, not networked): opens/focuses the Workspace at a target
 * view. For explicit verbs only ("open my calendar", "show my notes", "pull up
 * today"); informational questions still answer via calendar.list without
 * opening windows (enforced by the system prompt + eval forbid_tools guards).
 */
export interface AppOpenDeps {
  openWorkspace: (target: { view: 'chat' | 'today' | 'calendar' | 'notes'; dateIso?: string; noteId?: string }) => void;
}

const Params = z.object({
  view: z.enum(['chat', 'today', 'calendar', 'notes']),
  dateIso: z.string().optional(),
  noteId: z.string().optional(),
});

export function createAppOpenTool(deps: AppOpenDeps): ToolDef<typeof Params> {
  return {
    name: 'app.open',
    tier: 2,
    description:
      'Open or focus the Apollo Workspace window at a view. Use ONLY for explicit open/show/pull-up requests ("open my calendar", "show my notes", "pull up today", "open chat", "let me type", "show our conversation"). Do NOT use for informational questions like "what\'s on my calendar" — those use calendar.list and never open a window. view is chat, today, calendar, or notes; chat shows the typed conversation surface; dateIso optionally focuses a calendar date; noteId optionally opens a note.',
    params: Params,
    async execute(args) {
      deps.openWorkspace({ view: args.view, ...(args.dateIso ? { dateIso: args.dateIso } : {}), ...(args.noteId ? { noteId: args.noteId } : {}) });
      return { llmText: STRINGS.workspace.appOpened(args.view) };
    },
  };
}
