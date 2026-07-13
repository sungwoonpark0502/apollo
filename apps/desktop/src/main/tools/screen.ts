import { z } from 'zod';
import { STRINGS, type ToolDef } from '@apollo/shared';
import { type SpawnRunner } from './system';

/**
 * screen.context (C7, Phase 4): active window title + selected text via macOS
 * Accessibility / Windows UI Automation. On permission-missing, llmText
 * explains how to grant. Uses osascript with a fixed template (spawn, shell:false).
 */
export interface ScreenContext {
  app: string;
  title: string;
  selectedText: string;
  permissionMissing: boolean;
}

// Fixed AppleScript: frontmost app, its front window title, and the focused
// element's selected text (empty when unavailable). No interpolation.
const MAC_SCRIPT = [
  'tell application "System Events"',
  '  set frontApp to name of first application process whose frontmost is true',
  '  set winTitle to ""',
  '  set selText to ""',
  '  try',
  '    tell (first application process whose frontmost is true)',
  '      set winTitle to name of front window',
  '      try',
  '        set selText to value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement")',
  '      end try',
  '    end tell',
  '  end try',
  'end tell',
  'return frontApp & "\\n" & winTitle & "\\n" & selText',
].join('\n');

export interface ScreenDeps {
  run: SpawnRunner;
  platform?: NodeJS.Platform;
}

export async function readScreenContext(deps: ScreenDeps): Promise<ScreenContext> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') {
    // Windows UI Automation would go here; until implemented, report unavailable.
    return { app: '', title: '', selectedText: '', permissionMissing: false };
  }
  try {
    const { code, stdout } = await deps.run('osascript', ['-e', MAC_SCRIPT]);
    if (code !== 0) return { app: '', title: '', selectedText: '', permissionMissing: true };
    const [app = '', title = '', ...rest] = stdout.split('\n');
    return { app: app.trim(), title: title.trim(), selectedText: rest.join('\n').trim(), permissionMissing: false };
  } catch {
    return { app: '', title: '', selectedText: '', permissionMissing: true };
  }
}

export function createScreenTool(deps: ScreenDeps): ToolDef {
  return {
    name: 'screen.context',
    tier: 1,
    description:
      'Get the title of the active window and any text the user has selected on screen. Use when the user says "this", "here", or refers to what they are looking at.',
    params: z.object({}),
    async execute() {
      const ctx = await readScreenContext(deps);
      if (ctx.permissionMissing) {
        return { llmText: `ERROR ${STRINGS.errors.INTERNAL} ${STRINGS.permissions.accessibilityHint}` };
      }
      const parts = [
        ctx.app ? `Active app: ${ctx.app}.` : '',
        ctx.title ? `Window: ${ctx.title}.` : '',
        ctx.selectedText ? `Selected text: "${ctx.selectedText.slice(0, 500)}".` : 'No text is selected.',
      ].filter(Boolean);
      return { llmText: parts.join(' ') };
    },
  };
}
