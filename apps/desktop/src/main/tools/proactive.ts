import { z } from 'zod';
import { STRINGS, type Settings, type ToolDef } from '@apollo/shared';
import { type UndoRepo } from '../db/repos/undo';
import { registerInverse } from './undo';
import { BUILTIN_RULES } from '../proactive/rules/index';

/**
 * F3.4 voice control of proactivity: proactive.configure (enable/disable rules
 * or all) and proactive.status (enabled rules + remaining budget). Configure is
 * undoable.
 */
export interface ProactiveToolDeps {
  getSettings: () => Settings;
  setSettings: (next: Settings) => void;
  status: () => { enabledRules: string[]; remainingBudget: number };
  undo: UndoRepo;
}

const RULE_IDS = BUILTIN_RULES.map((r) => r.id);
const ruleIdEnum = z.enum([RULE_IDS[0] as string, ...RULE_IDS.slice(1), 'all'] as [string, ...string[]]);

function ruleDisplayName(ruleId: string): string {
  return ruleId === 'all' ? 'all proactive nudges' : (STRINGS.nudges.ruleNames[ruleId] ?? ruleId);
}

/** Applies an enabled state to a rule (or the master switch for 'all'); returns the prior state for undo. */
function applyState(settings: Settings, ruleId: string, enabled: boolean): { next: Settings; prevEnabled: boolean } {
  if (ruleId === 'all') {
    return { next: { ...settings, proactive: { ...settings.proactive, enabled } }, prevEnabled: settings.proactive.enabled };
  }
  const rule = BUILTIN_RULES.find((r) => r.id === ruleId);
  const prevEnabled = settings.proactive.rules[ruleId]?.enabled ?? rule?.defaultEnabled ?? true;
  const nextRules = { ...settings.proactive.rules, [ruleId]: { enabled, params: settings.proactive.rules[ruleId]?.params ?? {} } };
  return { next: { ...settings, proactive: { ...settings.proactive, rules: nextRules } }, prevEnabled };
}

export function createProactiveTools(deps: ProactiveToolDeps): ToolDef[] {
  // Undo restores the prior enabled state captured at configure time.
  registerInverse('proactive.configure', (_repos, data) => {
    const ruleId = String(data['ruleId']);
    const prevEnabled = data['prevEnabled'] === true;
    const { next } = applyState(deps.getSettings(), ruleId, prevEnabled);
    deps.setSettings(next);
    return `restored ${ruleDisplayName(ruleId)}`;
  });

  const configure: ToolDef<z.ZodType<{ ruleId: string; enabled: boolean }>> = {
    name: 'proactive.configure',
    tier: 2,
    description:
      'Turn a proactive nudge rule on or off, or "all" for every nudge. Use for requests like "stop reminding me about meetings" (ruleId meeting_lead, enabled false) or "stop all nudges" (ruleId all, enabled false). Rule ids: ' +
      RULE_IDS.join(', ') +
      '.',
    params: z.object({ ruleId: ruleIdEnum, enabled: z.boolean() }),
    async execute(a, ctx) {
      const { next, prevEnabled } = applyState(deps.getSettings(), a.ruleId, a.enabled);
      deps.setSettings(next);
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'proactive.configure', data: { ruleId: a.ruleId, prevEnabled } });
      const name = ruleDisplayName(a.ruleId);
      const llmText =
        a.ruleId === 'all'
          ? a.enabled ? STRINGS.nudges.allEnabled : STRINGS.nudges.allDisabled
          : a.enabled ? STRINGS.nudges.ruleEnabled(name) : STRINGS.nudges.ruleDisabled(name);
      return { llmText, undoToken };
    },
  };

  const status: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'proactive.status',
    tier: 1,
    description: 'Report which proactive nudges are on and how many nudges remain in today\'s budget. Use to answer "what nudges are on" or "why did you just ping me".',
    params: z.object({}),
    async execute() {
      const s = deps.status();
      return { llmText: STRINGS.nudges.status(s.enabledRules, s.remainingBudget) };
    },
  };

  return [configure, status];
}
