import { DateTime } from 'luxon';
import { type Settings, type SuggestionDTO, type WorkspaceNavigate } from '@apollo/shared';
import { type Repos } from '../db/repos/index';
import { createEngine, type Engine } from './engine';
import { BUILTIN_RULES } from './rules/index';
import { type ProactiveRule } from './types';

const AUTO_DISMISS_MS = 20_000; // F3.2 step 9: card auto-dismiss records 'expired'

export interface ProactiveControllerDeps {
  repos: Repos;
  settings: () => Settings;
  saveSettings: (next: Settings) => void;
  tz: () => string;
  gmailConnected: () => boolean;
  voiceBusy: () => boolean;
  isFullscreen: () => boolean;
  push: (payload: { suggestion?: SuggestionDTO; group?: SuggestionDTO[]; silent: boolean }) => void;
  notify: (title: string, body: string) => void;
  speak?: (line: string) => void;         // TTS one-liner (voiceOnNudges)
  navigate: (target: WorkspaceNavigate) => void;
  isDND: () => boolean;
  rules?: ProactiveRule[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  log?: (msg: string) => void;
}

export function createProactiveController(deps: ProactiveControllerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => { const h = setTimeout(fn, Math.max(0, ms)); return { cancel: () => clearTimeout(h) }; });
  const rules = deps.rules ?? BUILTIN_RULES;

  // Session state: delivered suggestions (id → dto) + their auto-dismiss timers.
  const live = new Map<string, { dto: SuggestionDTO; timer: { cancel: () => void } }>();
  let lastShown: SuggestionDTO | null = null;

  const engine: Engine = createEngine({
    repos: deps.repos,
    settings: deps.settings,
    tz: deps.tz,
    gmailConnected: deps.gmailConnected,
    voiceBusy: deps.voiceBusy,
    isFullscreen: deps.isFullscreen,
    deliver: (group, opts) => onDeliver(group, opts.silent),
    now,
    setTimer,
    rules,
    log: deps.log,
  });

  function onDeliver(group: SuggestionDTO[], silent: boolean): void {
    for (const dto of group) {
      const timer = setTimer(() => {
        if (live.has(dto.id)) {
          live.delete(dto.id);
          engine.recordOutcome(dto.id, 'expired');
        }
      }, AUTO_DISMISS_MS);
      live.set(dto.id, { dto, timer });
    }
    lastShown = group[group.length - 1] ?? lastShown;

    // Emit to the orb: a single nudge or a batched group.
    if (group.length === 1) deps.push({ suggestion: group[0], silent });
    else deps.push({ group, silent });

    // OS notification only for meeting_lead (F3.2 step 9).
    for (const dto of group) {
      if (dto.ruleId === 'meeting_lead') deps.notify(dto.title, dto.body);
    }

    // TTS one-liner only when enabled AND time-sensitive AND not DND.
    if (!silent && deps.settings().proactive.voiceOnNudges && !deps.isDND()) {
      const ts = group.find((d) => d.urgency === 'time-sensitive');
      if (ts) deps.speak?.(ts.body ? `${ts.title}. ${ts.body}` : ts.title);
    }
  }

  /** F1 suggestion.action: primary (deep link / disable) | snooze | dismiss. */
  function handleAction(suggestionId: string, actionId: string): void {
    const entry = live.get(suggestionId);
    const dto = entry?.dto ?? deps.repos.suggestions.get(suggestionId)?.payload;
    entry?.timer.cancel();
    live.delete(suggestionId);
    if (!dto) return;

    if (actionId === 'snooze') {
      engine.snooze(suggestionId, 5);
      return;
    }
    if (actionId === 'dismiss' || actionId === 'keep') {
      engine.recordOutcome(suggestionId, 'dismissed');
      return;
    }
    // primary actions
    engine.recordOutcome(suggestionId, 'acted');
    if (actionId === 'disable') {
      // auto-tune "Yes, stop": disable the rule in settings
      setRuleEnabled(dto.ruleId, false);
      return;
    }
    if (actionId === 'open') {
      const target = deepLinkFor(dto.ruleId);
      if (target) deps.navigate(target);
    }
  }

  function deepLinkFor(ruleId: string): WorkspaceNavigate | null {
    switch (ruleId) {
      case 'tomorrow_preview':
        return { view: 'calendar' };
      case 'overdue_todos':
        return { view: 'today' };
      default:
        return { view: 'today' };
    }
  }

  function setRuleEnabled(ruleId: string, enabled: boolean): void {
    const s = deps.settings();
    const rule = rules.find((r) => r.id === ruleId);
    const nextRules = { ...s.proactive.rules, [ruleId]: { enabled, params: s.proactive.rules[ruleId]?.params ?? {} } };
    deps.saveSettings({ ...s, proactive: { ...s.proactive, rules: nextRules } });
    if (rule) deps.log?.(`proactive rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  return {
    engine,
    start: () => engine.start(),
    onResume: () => engine.onResume(),
    reconfigure: () => engine.reconfigure(),
    handleAction,
    setRuleEnabled,
    /** proactive.status: enabled rule display-names + remaining budget today. */
    status(): { enabledRules: string[]; remainingBudget: number } {
      const s = deps.settings();
      const enabledRules = rules
        .filter((r) => (s.proactive.rules[r.id]?.enabled ?? r.defaultEnabled))
        .map((r) => r.name);
      const remainingBudget = Math.max(0, s.proactive.maxPerDay - deps.repos.suggestions.countShownToday(now()));
      return { enabledRules, remainingBudget };
    },
    lastShown: () => lastShown,
    stop: () => {
      for (const e of live.values()) e.timer.cancel();
      live.clear();
      engine.stop();
    },
    // test/introspection
    _live: live,
  };
}

export type ProactiveController = ReturnType<typeof createProactiveController>;

/** Shared DND check (F3.2 step 4) so controller + governor agree. */
export function isDNDNow(settings: Settings, tz: string, atMs: number): boolean {
  const { startHH, endHH } = settings.dnd;
  const hour = DateTime.fromMillis(atMs, { zone: tz }).hour;
  return startHH <= endHH ? hour >= startHH && hour < endHH : hour >= startHH || hour < endHH;
}
