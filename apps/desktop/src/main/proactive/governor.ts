import { DateTime } from 'luxon';
import { STRINGS, type Settings, type SuggestionDTO } from '@apollo/shared';
import { type SuggestionsRepo } from '../db/repos/suggestions';
import { type CandidateSuggestion } from './types';

const MIN = 60_000;
const SPACING_MS = 20 * MIN;
const BUSY_DEFER_MS = 30_000;
const FULLSCREEN_DEFER_MS = 10 * MIN;
const AUTO_TUNE_WINDOW = 5;
const META_COOLDOWN_MS = 30 * 86_400_000;
const MAX_GROUP = 4;

export interface GovernorDeps {
  now: () => number;
  tz: () => string;
  repo: SuggestionsRepo;
  settings: () => Settings;
  voiceBusy: () => boolean;
  isFullscreen: () => boolean;
  deliver: (group: SuggestionDTO[], opts: { silent: boolean }) => void;
  ruleDisplayName: (ruleId: string) => string;
  log?: (msg: string) => void;
}

export interface Deferral {
  candidate: CandidateSuggestion;
  atMs: number;
}
export interface GovernorResult {
  deferrals: Deferral[];
}

type Decision = { kind: 'deliver'; silent: boolean } | { kind: 'defer'; atMs: number } | { kind: 'drop' };

/** F3.2 governor: the politeness pipeline, code-enforced and clock-injectable. */
export function createGovernor(deps: GovernorDeps) {
  function isDND(atMs: number): boolean {
    const { startHH, endHH } = deps.settings().dnd;
    const hour = DateTime.fromMillis(atMs, { zone: deps.tz() }).hour;
    return startHH <= endHH ? hour >= startHH && hour < endHH : hour >= startHH || hour < endHH;
  }

  function dndEndMs(atMs: number): number {
    const { endHH } = deps.settings().dnd;
    const local = DateTime.fromMillis(atMs, { zone: deps.tz() });
    let end = local.startOf('day').plus({ hours: endHH });
    if (end.toMillis() <= atMs) end = end.plus({ days: 1 });
    return end.toMillis();
  }

  function startOfTomorrowMs(atMs: number): number {
    return DateTime.fromMillis(atMs, { zone: deps.tz() }).plus({ days: 1 }).startOf('day').toMillis();
  }

  /** F3.2 step 10 (auto-tune): a rule whose last 5 outcomes are all dismissed/expired
   *  gets its next candidate replaced once by a meta-nudge (max once / 30 days). */
  function maybeAutoTune(candidate: CandidateSuggestion, now: number): CandidateSuggestion {
    const recent = deps.repo.recentOutcomes(candidate.ruleId, AUTO_TUNE_WINDOW);
    const allNegative = recent.length === AUTO_TUNE_WINDOW && recent.every((o) => o === 'dismissed' || o === 'expired');
    if (!allNegative) return candidate;
    const lastMeta = deps.repo.lastMetaNudgeAt(candidate.ruleId);
    if (lastMeta !== null && now - lastMeta < META_COOLDOWN_MS) return candidate;
    const dateIso = DateTime.fromMillis(now, { zone: deps.tz() }).toISODate() ?? '';
    const ruleName = deps.ruleDisplayName(candidate.ruleId);
    return {
      ruleId: candidate.ruleId,
      urgency: 'normal',
      title: STRINGS.nudges.autoTuneQuestion(ruleName),
      body: '',
      actions: [
        { id: 'disable', label: STRINGS.nudges.autoTuneYes, kind: 'primary' },
        { id: 'keep', label: STRINGS.nudges.autoTuneKeep, kind: 'dismiss' },
      ],
      dedupeKey: `meta:${candidate.ruleId}:${dateIso}`,
      expiresAt: now + 86_400_000,
    };
  }

  function decide(c: CandidateSuggestion, now: number): Decision {
    const ts = c.urgency === 'time-sensitive';
    let silent = false;

    // Step 4: DND window
    if (isDND(now)) {
      if (ts) silent = true; // time-sensitive: silent delivery, continues the pipeline
      else return { kind: 'defer', atMs: dndEndMs(now) + MIN };
    }

    // Step 5: budget (low/normal only)
    if (!ts) {
      const shown = deps.repo.countShownToday(now);
      if (shown >= deps.settings().proactive.maxPerDay) {
        const slot = startOfTomorrowMs(now);
        if (c.expiresAt <= slot) return { kind: 'drop' };
        return { kind: 'defer', atMs: slot };
      }
    }

    // Step 6: busy check — voice interaction defers everything 30s
    if (deps.voiceBusy()) return { kind: 'defer', atMs: now + BUSY_DEFER_MS };
    // Step 6: fullscreen — deliver only time-sensitive; others defer 10 min
    if (deps.isFullscreen() && !ts) return { kind: 'defer', atMs: now + FULLSCREEN_DEFER_MS };

    // Step 7: rate spacing — >= 20 min between non-time-sensitive deliveries
    if (!ts) {
      const last = deps.repo.lastShownAt();
      if (last !== null && now - last < SPACING_MS) return { kind: 'defer', atMs: last + SPACING_MS };
    }

    return { kind: 'deliver', silent };
  }

  return {
    /** Runs one batch through the pipeline; delivers survivors, returns deferrals. */
    process(candidates: CandidateSuggestion[]): GovernorResult {
      const deferrals: Deferral[] = [];
      if (!deps.settings().proactive.enabled) return { deferrals };
      const now = deps.now();

      // Steps 2-3: dedupe + expiry
      const seenRule = new Set<string>();
      const survivors: CandidateSuggestion[] = [];
      for (const raw of candidates) {
        if (now >= raw.expiresAt) continue; // expired
        if (deps.repo.exists(raw.ruleId, raw.dedupeKey)) continue; // deduped
        // Auto-tune: replace the first surviving candidate of a qualifying rule.
        let c = raw;
        if (!seenRule.has(raw.ruleId)) {
          seenRule.add(raw.ruleId);
          c = maybeAutoTune(raw, now);
          if (c !== raw && deps.repo.exists(c.ruleId, c.dedupeKey)) continue; // meta already shown today
        }
        survivors.push(c);
      }

      // Steps 4-7: per-candidate decision
      const deliverable: CandidateSuggestion[] = [];
      let anyNonSilent = false;
      let anySilent = false;
      for (const c of survivors) {
        const d = decide(c, now);
        if (d.kind === 'defer') deferrals.push({ candidate: c, atMs: d.atMs });
        else if (d.kind === 'deliver') {
          deliverable.push(c);
          if (d.silent) anySilent = true;
          else anyNonSilent = true;
        }
        // drop: nothing
      }
      if (deliverable.length === 0) return { deferrals };

      // Step 8: batch — time-sensitive first, max 4, overflow deferred a spacing window out
      deliverable.sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency));
      const group = deliverable.slice(0, MAX_GROUP);
      for (const overflow of deliverable.slice(MAX_GROUP)) deferrals.push({ candidate: overflow, atMs: now + SPACING_MS });

      // Step 9: delivery — persist rows, mark shown, emit
      const dtos: SuggestionDTO[] = [];
      for (const c of group) {
        const row = deps.repo.createIfAbsent(
          { ruleId: c.ruleId, dedupeKey: c.dedupeKey, urgency: c.urgency, payload: { title: c.title, body: c.body, ...(c.card ? { card: c.card } : {}), actions: c.actions } },
          now,
        );
        if (!row) continue; // race: already exists
        deps.repo.markShown(row.id, now);
        dtos.push(row.payload);
      }
      if (dtos.length > 0) {
        const silent = anySilent && !anyNonSilent;
        deps.deliver(dtos, { silent });
      }
      return { deferrals };
    },

    // exposed for tests
    _isDND: isDND,
    _dndEndMs: dndEndMs,
  };
}

function urgencyRank(u: SuggestionDTO['urgency']): number {
  return u === 'time-sensitive' ? 2 : u === 'normal' ? 1 : 0;
}

export type Governor = ReturnType<typeof createGovernor>;
