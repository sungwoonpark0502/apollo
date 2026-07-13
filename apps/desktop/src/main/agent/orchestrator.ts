import { DateTime } from 'luxon';
import {
  newId,
  STRINGS,
  toErrorCode,
  type AgentEvent,
  type CardPayload,
  type ConfirmAction,
  type MessageSource,
  type ToolCtx,
} from '@apollo/shared';
import { type Registry } from '../tools/registry';
import { type Repos } from '../db/repos/index';
import { LlmAbortError, type LlmClient, type LlmMessage, type LlmToolUse } from './llm';
import { matchFastPath } from './fastPath';
import { computeTaintFlags } from './taint';
import { createConfirmationStore, matchConfirmReply, type PendingConfirmation } from './confirmations';

const MAX_ITERATIONS = 8;
const CANCEL_WINDOW_TOOLS = new Set(['email.send']);
const REFUSAL_RE = /can'?t|cannot|unable|not able to/i;

export interface OrchestratorDeps {
  registry: Registry;
  repos: Repos;
  llm: LlmClient;
  systemPrompt: () => string;
  emit: (event: AgentEvent) => void;
  tz: () => string;
  historyEnabled: () => boolean;
  buildContext?: () => Record<string, string | number>;
  now?: () => number;
  confirmTtlMs?: number;
  cancelWindowMs?: number;
  voiceHooks?: { setMuted?: (on: boolean) => void; stopTts?: () => void };
  log?: (msg: string) => void;
}

interface LoopSnapshot {
  turnId: string;
  convId: string;
  source: MessageSource;
  utterance: string;
  messages: LlmMessage[];
  iterations: number;
  toolsRan: number;
  pendingToolUse: LlmToolUse;
  batchResults: Array<{ toolUseId: string; content: string; isError?: boolean }>;
  remainingToolUses: LlmToolUse[];
}

interface TurnHandle {
  abort: AbortController;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const now = deps.now ?? Date.now;
  const emit = deps.emit;
  const conversationTaint = new Map<string, boolean>();
  const utterancesByConv = new Map<string, string[]>();
  const activeTurns = new Map<string, TurnHandle>();
  const cancelWindowAborts = new Map<string, AbortController>();

  const confirmations = createConfirmationStore<LoopSnapshot>({
    ttlMs: deps.confirmTtlMs ?? 120_000,
    now,
    onAutoResolve: (pending, reason) => {
      void resumeWithResult(pending, reason === 'superseded' ? 'superseded' : 'user declined');
    },
  });

  function userUtterances(convId: string): string[] {
    let u = utterancesByConv.get(convId);
    if (!u) {
      u = [];
      utterancesByConv.set(convId, u);
    }
    return u;
  }

  function toolCtx(turn: { turnId: string; convId: string; source: MessageSource }): ToolCtx {
    return {
      now: () => new Date(now()),
      tz: deps.tz(),
      convId: turn.convId,
      turnId: turn.turnId,
      taint: conversationTaint.get(turn.convId) ?? false,
      userUtterances: userUtterances(turn.convId),
      source: turn.source,
    };
  }

  function persist(convId: string, role: 'user' | 'assistant' | 'tool', content: string): void {
    if (!deps.historyEnabled() || !content) return;
    deps.repos.conversations.ensure(convId);
    deps.repos.conversations.addMessage({ convId, role, content });
  }

  function contextBlock(): string {
    const extra = deps.buildContext?.() ?? {};
    const lines = [
      `now: ${DateTime.fromMillis(now(), { zone: deps.tz() }).toISO({ suppressMilliseconds: true })}`,
      `tz: ${deps.tz()}`,
      `pendingTimers: ${deps.repos.timers.listActive().length}`,
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    ];
    return `<context>\n${lines.join('\n')}\n</context>`;
  }

  function buildSystem(): string {
    const digest = deps.repos.memory.digest();
    return [deps.systemPrompt(), contextBlock(), digest ? `Known facts about the user (newest first):\n${digest}` : '']
      .filter(Boolean)
      .join('\n\n');
  }

  function historyMessages(convId: string): LlmMessage[] {
    if (!deps.historyEnabled()) return [];
    return deps.repos.conversations.lastMessages(convId, 20).map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: [{ type: 'text' as const, text: m.content }],
    }));
  }

  function wrapResult(toolName: string, llmText: string, untrusted: boolean | undefined): string {
    return untrusted ? `<data source="${toolName}">\n${llmText}\n</data>` : llmText;
  }

  async function executeToolUse(tu: LlmToolUse, turn: LoopSnapshot | TurnState): Promise<{ content: string; isError: boolean; card?: CardPayload; untrusted?: boolean }> {
    emit({ type: 'toolStart', tool: tu.name });
    const res = await deps.registry.execute(tu.name, tu.input, toolCtx(turn));
    const ok = !res.llmText.startsWith('ERROR');
    emit({ type: 'toolResult', tool: tu.name, ok });
    if (res.card) emit({ type: 'card', card: res.card });
    if (res.untrusted) conversationTaint.set(turn.convId, true);
    return { content: wrapResult(tu.name, res.llmText, res.untrusted), isError: !ok, card: res.card, untrusted: res.untrusted };
  }

  interface TurnState {
    turnId: string;
    convId: string;
    source: MessageSource;
    utterance: string;
    messages: LlmMessage[];
    iterations: number;
    toolsRan: number;
    signal: AbortSignal;
  }

  /** Core loop from C8 steps 4–10; shared by fresh turns and confirmation resumes. */
  async function runLoop(state: TurnState): Promise<void> {
    const t0 = now();
    let firstTokenAt: number | null = null;
    let finalText: string;

    try {
      for (;;) {
        if (state.iterations >= MAX_ITERATIONS) {
          const apology = 'I had to stop there — that took more steps than I allow. Here is what I completed so far.';
          emit({ type: 'token', text: apology });
          finalText = apology;
          break;
        }
        state.iterations += 1;

        let turnText = '';
        const res = await deps.llm.stream({
          system: buildSystem(),
          messages: state.messages,
          tools: deps.registry.anthropicTools(),
          maxTokens: state.source === 'voice' ? 1024 : 4096,
          signal: state.signal,
          onText: (delta) => {
            if (firstTokenAt === null) {
              firstTokenAt = now();
              deps.repos.perf.record(state.turnId, 'llm_first_token', firstTokenAt - t0);
            }
            turnText += delta;
            emit({ type: 'token', text: delta });
          },
        });
        finalText = res.text || turnText;

        if (res.toolUses.length === 0) {
          // Dead-end guard (C8.10)
          if (state.toolsRan === 0 && REFUSAL_RE.test(finalText)) {
            deps.repos.capabilityMisses.add(state.utterance);
            const search = deps.registry.get('search.web');
            if (search) {
              state.messages.push({ role: 'assistant', content: [{ type: 'text', text: finalText }] });
              state.messages.push({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `[system] Do not refuse. A web search for the user's request was performed; answer from these results and offer the nearest alternative.`,
                  },
                ],
              });
              const tu: LlmToolUse = { id: `tu_${newId()}`, name: 'search.web', input: { query: state.utterance } };
              const r = await executeToolUse(tu, state);
              state.toolsRan += 1;
              state.messages.push({ role: 'user', content: [{ type: 'text', text: r.content }] });
              continue;
            }
          }
          break;
        }

        // Assistant turn with tool_use blocks
        const assistantContent = [
          ...(finalText ? [{ type: 'text' as const, text: finalText }] : []),
          ...res.toolUses.map((tu) => ({ type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input })),
        ];
        state.messages.push({ role: 'assistant', content: assistantContent });

        const tier12: LlmToolUse[] = [];
        const tier3: LlmToolUse[] = [];
        for (const tu of res.toolUses) {
          const def = deps.registry.get(tu.name);
          if (def && def.tier === 3) tier3.push(tu);
          else tier12.push(tu);
        }

        // Tier 1/2 execute in parallel (C8.6)
        const results = await Promise.all(tier12.map((tu) => executeToolUse(tu, state)));
        state.toolsRan += tier12.length;
        const batchResults = tier12.map((tu, i) => ({
          toolUseId: tu.id,
          content: results[i]!.content,
          isError: results[i]!.isError,
        }));

        if (tier3.length > 0) {
          // Confirm the first Tier 3; any extra in the same batch is superseded immediately (C8.8)
          const [first, ...rest] = tier3 as [LlmToolUse, ...LlmToolUse[]];
          for (const extra of rest) batchResults.push({ toolUseId: extra.id, content: 'superseded', isError: false });
          suspendForConfirmation(state, first, batchResults);
          return; // turn output ends; state retained in the confirmation store
        }

        for (const r of batchResults) {
          state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, is_error: r.isError || undefined }] });
        }
      }

      persist(state.convId, 'assistant', finalText);
      deps.repos.perf.record(state.turnId, 'turn_total', now() - t0);
      emit({ type: 'done', turnId: state.turnId });
    } catch (e) {
      if (e instanceof LlmAbortError || state.signal.aborted) {
        emit({ type: 'done', turnId: state.turnId }); // CANCELED is silent (C16)
        return;
      }
      const code = toErrorCode(e);
      const copy = errorCopy(code);
      deps.log?.(`turn ${state.turnId} failed: ${e instanceof Error ? e.message : String(e)}`);
      emit({ type: 'error', code, userMessage: copy });
      emit({ type: 'done', turnId: state.turnId });
    } finally {
      activeTurns.delete(state.turnId);
    }
  }

  function summarizeAction(tu: LlmToolUse, taintFlags: string[]): ConfirmAction {
    const args = (tu.input ?? {}) as Record<string, unknown>;
    let summary: string;
    if (tu.name === 'email.send') {
      const to = Array.isArray(args['to']) ? (args['to'] as string[]).join(', ') : String(args['to'] ?? '');
      summary = STRINGS.confirm.emailSummary(to, String(args['subject'] ?? ''));
    } else {
      summary = `Run ${tu.name} with ${JSON.stringify(args)}`;
    }
    return { toolName: tu.name, summary, args, taintFlags };
  }

  /** Contact emails matching any recipient value, so contact-resolved recipients clear the taint flag (C13). */
  function recipientKnownValues(args: Record<string, unknown>): string[] {
    const recipients: string[] = [];
    for (const key of ['to', 'cc', 'bcc']) {
      const v = args[key];
      if (typeof v === 'string') recipients.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') recipients.push(x);
    }
    const known: string[] = [];
    for (const r of recipients) {
      for (const c of deps.repos.contacts.findByEmail(r)) {
        if (c.email) known.push(c.email);
      }
    }
    return known;
  }

  function suspendForConfirmation(state: TurnState, tu: LlmToolUse, batchResults: LoopSnapshot['batchResults']): void {
    const taint = conversationTaint.get(state.convId) ?? false;
    const args = (tu.input ?? {}) as Record<string, unknown>;
    // C13: email.send recipients are checked even when taint is false; a saved
    // contact whose email matches clears the flag.
    const isEmailSend = tu.name === 'email.send';
    const knownValues = isEmailSend ? recipientKnownValues(args) : [];
    const flags =
      taint || isEmailSend
        ? computeTaintFlags(args, userUtterances(state.convId), {
            taint,
            knownValues,
            alwaysCheckKeys: isEmailSend ? new Set(['to', 'cc', 'bcc']) : undefined,
          })
        : [];
    const action = summarizeAction(tu, flags);
    const pending = confirmations.create(action, {
      turnId: state.turnId,
      convId: state.convId,
      source: state.source,
      utterance: state.utterance,
      messages: state.messages,
      iterations: state.iterations,
      toolsRan: state.toolsRan,
      pendingToolUse: tu,
      batchResults,
      remainingToolUses: [],
    });
    emit({ type: 'confirmRequest', confirmationId: pending.confirmationId, action, expiresAt: pending.expiresAt });
    emit({ type: 'card', card: { kind: 'confirm', confirmationId: pending.confirmationId, action, expiresAt: pending.expiresAt } });
    emit({ type: 'token', text: STRINGS.confirm.askShort });
    emit({ type: 'done', turnId: state.turnId });
    activeTurns.delete(state.turnId);
  }

  async function resumeWithResult(pending: PendingConfirmation<LoopSnapshot>, resultText: string): Promise<void> {
    const s = pending.snapshot;
    const abort = new AbortController();
    activeTurns.set(s.turnId, { abort });
    const state: TurnState = { ...s, signal: abort.signal };
    for (const r of s.batchResults) {
      state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, is_error: r.isError || undefined }] });
    }
    state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: s.pendingToolUse.id, content: resultText }] });
    await runLoop(state);
  }

  async function resumeApproved(pending: PendingConfirmation<LoopSnapshot>): Promise<void> {
    const s = pending.snapshot;
    const abort = new AbortController();
    activeTurns.set(s.turnId, { abort });
    const state: TurnState = { ...s, signal: abort.signal };

    // email.send 5s grace window (C8.9)
    if (CANCEL_WINDOW_TOOLS.has(s.pendingToolUse.name)) {
      const windowMs = deps.cancelWindowMs ?? 5000;
      emit({ type: 'cancelWindow', confirmationId: pending.confirmationId, ms: windowMs });
      const windowAbort = new AbortController();
      cancelWindowAborts.set(s.turnId, windowAbort);
      const canceled = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), windowMs);
        windowAbort.signal.addEventListener('abort', () => {
          clearTimeout(t);
          resolve(true);
        });
      });
      cancelWindowAborts.delete(s.turnId);
      if (canceled) {
        state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: s.pendingToolUse.id, content: 'user canceled during grace period' }] });
        for (const r of s.batchResults) {
          state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, is_error: r.isError || undefined }] });
        }
        await runLoop(state);
        return;
      }
    }

    const r = await executeToolUse(s.pendingToolUse, state);
    state.toolsRan += 1;
    for (const br of s.batchResults) {
      state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: br.toolUseId, content: br.content, is_error: br.isError || undefined }] });
    }
    state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: s.pendingToolUse.id, content: r.content, is_error: r.isError || undefined }] });
    await runLoop(state);
  }

  /** Fast path (C9): executes without the LLM. Returns true when handled. */
  async function tryFastPath(state: TurnState): Promise<boolean> {
    const hit = matchFastPath(state.utterance);
    if (!hit) return false;
    const ctx = toolCtx(state);
    const t0 = now();

    const finish = (reply: string): void => {
      emit({ type: 'token', text: reply });
      persist(state.convId, 'assistant', reply);
      deps.repos.perf.record(state.turnId, 'turn_total', now() - t0);
      emit({ type: 'done', turnId: state.turnId });
      activeTurns.delete(state.turnId);
    };

    switch (hit.kind) {
      case 'timer': {
        if (!deps.registry.get('timer.start')) return false;
        const res = await deps.registry.execute('timer.start', { durationSec: hit.seconds }, ctx);
        if (res.card) emit({ type: 'card', card: res.card });
        finish(STRINGS.spoken.timerSet(describeDurationSpoken(hit.seconds)));
        return true;
      }
      case 'timeNow': {
        finish(STRINGS.spoken.timeNow(DateTime.fromMillis(now(), { zone: deps.tz() }).toFormat('h:mm a')));
        return true;
      }
      case 'dateToday': {
        finish(STRINGS.spoken.dateToday(DateTime.fromMillis(now(), { zone: deps.tz() }).toFormat('cccc, LLLL d')));
        return true;
      }
      case 'openApp': {
        if (!deps.registry.get('system.openApp')) return false;
        const res = await deps.registry.execute('system.openApp', { name: hit.app }, ctx);
        finish(res.llmText.startsWith('ERROR') || res.llmText.startsWith('WARNING') ? res.llmText.replace(/^(ERROR|WARNING)\s*/, '') : STRINGS.spoken.appOpened(hit.app));
        return true;
      }
      case 'volume': {
        if (!deps.registry.get('system.volume')) return false;
        const res = await deps.registry.execute('system.volume', hit.op === 'set' ? { op: 'set', value: hit.value } : { op: hit.op }, ctx);
        finish(res.llmText.replace(/^(ERROR|WARNING)\s*/, ''));
        return true;
      }
      case 'mute': {
        deps.voiceHooks?.setMuted?.(hit.on);
        finish(hit.on ? STRINGS.spoken.muted : STRINGS.spoken.unmuted);
        return true;
      }
      case 'stopTalking': {
        deps.voiceHooks?.stopTts?.();
        finish(STRINGS.spoken.stoppedTalking);
        return true;
      }
      case 'media': {
        if (!deps.registry.get('system.media')) return false;
        await deps.registry.execute('system.media', { op: hit.op }, ctx);
        finish('');
        return true;
      }
      case 'brief': {
        // "good morning" → daily brief, composed locally so it works LLM-down (C19).
        if (!deps.registry.get('brief.daily')) return false;
        const res = await deps.registry.execute('brief.daily', {}, ctx);
        if (res.card) emit({ type: 'card', card: res.card });
        finish(res.llmText);
        return true;
      }
    }
  }

  return {
    /** C4 agent.userMessage: kicks off the turn; events stream via emit. */
    handleUserMessage(input: { text: string; source: MessageSource; convId: string }): { turnId: string; completion: Promise<void> } {
      const turnId = newId();
      const abort = new AbortController();
      activeTurns.set(turnId, { abort });

      const completion = (async () => {
        emit({ type: 'turnStart', turnId });
        userUtterances(input.convId).push(input.text);
        const history = historyMessages(input.convId); // before persisting this turn's text
        persist(input.convId, 'user', input.text);

        // Pending confirmation + approve/deny lexicon resolves without an LLM call (C8.1)
        const pending = confirmations.get();
        if (pending) {
          const verdict = matchConfirmReply(input.text);
          if (verdict) {
            const taken = confirmations.take(pending.confirmationId);
            emit({ type: 'done', turnId });
            activeTurns.delete(turnId);
            if (taken) {
              if (verdict === 'approve') await resumeApproved(taken);
              else await resumeWithResult(taken, 'user declined');
            }
            return;
          }
        }

        const state: TurnState = {
          turnId,
          convId: input.convId,
          source: input.source,
          utterance: input.text,
          messages: [...history, { role: 'user', content: [{ type: 'text', text: input.text }] }],
          iterations: 0,
          toolsRan: 0,
          signal: abort.signal,
        };

        if (await tryFastPath(state)) return;
        await runLoop(state);
      })().catch((e: unknown) => {
        deps.log?.(`turn crashed: ${e instanceof Error ? e.message : String(e)}`);
        emit({ type: 'error', code: 'INTERNAL', userMessage: STRINGS.errors.INTERNAL });
        emit({ type: 'done', turnId });
      });

      return { turnId, completion };
    },

    /** C4 agent.confirm. */
    async confirm(confirmationId: string, approved: boolean): Promise<void> {
      const pending = confirmations.take(confirmationId);
      if (!pending) return; // stale or unknown: silently ignored
      if (approved) await resumeApproved(pending);
      else await resumeWithResult(pending, 'user declined');
    },

    /** C4 agent.cancel: aborts the stream/grace window; CANCELED is silent. */
    cancel(turnId: string): void {
      cancelWindowAborts.get(turnId)?.abort();
      activeTurns.get(turnId)?.abort.abort();
      deps.voiceHooks?.stopTts?.();
    },

    /** Test/diagnostic access. */
    hasPendingConfirmation(): boolean {
      return confirmations.get() !== null;
    },
  };
}

function errorCopy(code: ReturnType<typeof toErrorCode>): string {
  switch (code) {
    case 'KEY_MISSING':
    case 'KEY_INVALID':
      return STRINGS.errors.KEY_MISSING('Anthropic');
    case 'RATE_LIMITED':
      return STRINGS.errors.RATE_LIMITED;
    case 'OFFLINE':
      return STRINGS.errors.LLM_DOWN;
    case 'LLM_DOWN':
      return STRINGS.errors.LLM_DOWN;
    case 'TIMEOUT':
      return STRINGS.errors.TIMEOUT;
    default:
      return STRINGS.errors.INTERNAL;
  }
}

function describeDurationSpoken(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ');
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
