import { type CardPayload, type Settings, type SuggestionAction, type Urgency } from '@apollo/shared';
import { type Repos } from '../db/repos/index';

/** F3.1 candidate: SuggestionDTO fields minus id/createdAt/ruleId, plus dedupeKey + expiresAt. */
export interface CandidateSuggestion {
  ruleId: string;
  urgency: Urgency;
  title: string;
  body: string;
  card?: CardPayload;
  actions: SuggestionAction[];
  dedupeKey: string;
  expiresAt: number; // ms; candidate dropped once now >= expiresAt
}

export type RuleTrigger = 'tick' | 'data:event' | 'data:todo' | 'data:reminder' | 'boot' | 'resume';

export interface RuleCtx {
  now: number;
  tz: string;
  repos: Repos; // read-only usage by rules (evaluate must have no side effects)
  settings: Settings;
  gmailConnected: boolean;
}

export interface ProactiveRule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  defaultParams: Record<string, number | string | boolean>;
  triggers: RuleTrigger[];
  /** Pure w.r.t. RuleCtx; no side effects. Returns 0+ candidates. */
  evaluate(ctx: RuleCtx): Promise<CandidateSuggestion[]>;
}

/** Reads a rule param from settings (falling back to the rule default). */
export function ruleParam(rule: ProactiveRule, settings: Settings, key: string): number | string | boolean {
  const configured = settings.proactive.rules[rule.id]?.params[key];
  return configured ?? rule.defaultParams[key] ?? 0;
}

export function ruleEnabled(rule: ProactiveRule, settings: Settings): boolean {
  const cfg = settings.proactive.rules[rule.id];
  return cfg ? cfg.enabled : rule.defaultEnabled;
}
