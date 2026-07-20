import type { AlertKind, InvokeChannelName, InvokeReq } from '@apollo/shared';

/**
 * L3.2 control dispatch registry.
 *
 * Every interactive control on the orb surfaces (orb menu, TTS controls, Stage
 * cards, confirm/batch cards, the ringing overlay, and nudge cards) resolves its
 * IPC call here rather than inline in JSX. Two reasons:
 *
 *  1. A control that dispatches nothing is visible as a `null` return, not as an
 *     absent onClick nobody notices. The audit in AUDIT-controls.md enumerates
 *     the registry, so a new control that skips it fails the coverage test.
 *  2. The dispatch becomes testable without a DOM: the tests assert the exact
 *     channel and payload per control, which is what "traced to a real IPC
 *     dispatch" has to mean. Rendering with Fake adapters proved nothing here —
 *     it exercised the handler, never the wire.
 *
 * Controls whose entire effect is local (card pin, playback skip/replay) return
 * `local` so they are still enumerated and still explained, rather than silently
 * missing from the table.
 */

/** A control either sends one IPC message or is deliberately renderer-local. */
export type Dispatch =
  | { readonly kind: 'ipc'; readonly channel: InvokeChannelName; readonly payload: unknown }
  | { readonly kind: 'local'; readonly why: string };

function ipc<C extends InvokeChannelName>(channel: C, payload: InvokeReq<C>): Dispatch {
  return { kind: 'ipc', channel, payload };
}

const local = (why: string): Dispatch => ({ kind: 'local', why });

/** Which surface a control lives on; mirrors the AUDIT-controls.md sections. */
export type Surface = 'orbMenu' | 'orbTts' | 'orbThinking' | 'stage' | 'confirm' | 'ringing' | 'nudge' | 'card';

export interface ControlSpec {
  readonly id: string;
  readonly surface: Surface;
  /** Human label, for the audit table. */
  readonly label: string;
}

/**
 * The catalogue the coverage test walks. Adding a control to a surface without
 * adding it here fails `controlDispatch.test.ts`.
 */
export const ORB_CONTROLS: readonly ControlSpec[] = [
  { id: 'orb.menu.openChat', surface: 'orbMenu', label: 'Open chat' },
  { id: 'orb.menu.openApollo', surface: 'orbMenu', label: 'Open Apollo' },
  { id: 'orb.thinking.cancel', surface: 'orbThinking', label: 'Cancel' },
  { id: 'orb.tts.stop', surface: 'orbTts', label: 'Stop' },
  { id: 'orb.tts.skip', surface: 'orbTts', label: 'Skip sentence' },
  { id: 'orb.tts.replay', surface: 'orbTts', label: 'Replay' },
  { id: 'card.openInChat', surface: 'card', label: 'Open in chat' },
  { id: 'card.pin', surface: 'card', label: 'Pin / unpin card' },
  { id: 'stage.openInApollo', surface: 'stage', label: 'Open in Apollo' },
  { id: 'stage.newsRow', surface: 'stage', label: 'News headline link' },
  { id: 'confirm.approve', surface: 'confirm', label: 'Confirm' },
  { id: 'confirm.deny', surface: 'confirm', label: 'Cancel' },
  { id: 'confirm.batchApprove', surface: 'confirm', label: 'Confirm batch (with per-item denials)' },
  { id: 'confirm.batchDeny', surface: 'confirm', label: 'Cancel batch' },
  { id: 'confirm.cancelWindow', surface: 'confirm', label: 'Undo within the cancel window' },
  { id: 'ringing.dismiss', surface: 'ringing', label: 'Dismiss alert' },
  { id: 'ringing.complete', surface: 'ringing', label: 'Complete reminder' },
  { id: 'ringing.snooze', surface: 'ringing', label: 'Snooze alert' },
  { id: 'nudge.action', surface: 'nudge', label: 'Nudge action (per suggestion)' },
  { id: 'nudge.dismissFirstRunNote', surface: 'nudge', label: 'Dismiss the first-nudge explainer' },
  { id: 'recall.openNote', surface: 'card', label: 'Open a recalled note' },
  { id: 'email.sendDraft', surface: 'card', label: 'Send drafted email' },
  { id: 'email.loadImages', surface: 'card', label: 'Load remote images' },
  { id: 'sync.resolveConflict', surface: 'card', label: 'Resolve a sync conflict' },
  { id: 'timer.cancel', surface: 'card', label: 'Cancel timer' },
  { id: 'event.delete', surface: 'card', label: 'Delete event' },
] as const;

/** Everything a control might need to build its payload. */
export interface ControlContext {
  readonly turnId?: string | null;
  readonly convId?: string | null;
  readonly confirmationId?: string;
  readonly approved?: boolean;
  readonly deniedIndices?: number[];
  readonly alert?: { kind: AlertKind; id: string };
  readonly action?: 'dismiss' | 'snooze';
  readonly snoozeMin?: number;
  readonly suggestionId?: string;
  readonly actionId?: string;
  readonly deepLink?: { view: 'today' | 'calendar' | 'notes'; dateIso?: string } | null;
  readonly id?: string;
  readonly noteId?: string;
  readonly text?: string;
  readonly eventId?: string;
  readonly choice?: 'mine' | 'theirs' | 'both';
}

/**
 * Resolves a control to its dispatch. Returns null only when the control is
 * correctly inert for the given context (no turn in flight, no deep link on
 * this card kind) — never because a control was left unwired.
 */
export function controlDispatch(id: string, ctx: ControlContext = {}): Dispatch | null {
  switch (id) {
    case 'orb.menu.openChat':
      return ipc('workspace.open', { view: 'chat', ...(ctx.convId ? { convId: ctx.convId } : {}) });
    case 'orb.menu.openApollo':
      return ipc('workspace.open', { view: 'today' });

    case 'orb.thinking.cancel':
      // No turn in flight means nothing to cancel; the button is not rendered.
      return ctx.turnId ? ipc('agent.cancel', { turnId: ctx.turnId }) : null;

    case 'orb.tts.stop':
      // Flushing playback is local; telling the FSM the queue drained is not,
      // or voice would sit in 'speaking' forever.
      return ipc('tts.drained', {});
    case 'orb.tts.skip':
      return local('advances the local playback queue by one sentence; audio is already synthesized');
    case 'orb.tts.replay':
      return local('replays retained buffers of the current reply; no LLM turn, no re-synthesis');

    case 'card.openInChat':
      return ctx.convId ? ipc('workspace.open', { view: 'chat', convId: ctx.convId }) : null;
    case 'card.pin':
      return local('holds the card against auto-dismiss for this panel session only (C18)');

    case 'stage.openInApollo':
      return ctx.deepLink ? ipc('workspace.open', ctx.deepLink) : null;
    case 'stage.newsRow':
      return local('an https anchor; windows.ts setWindowOpenHandler routes it to shell.openExternal');

    case 'confirm.approve':
      return ctx.confirmationId ? ipc('agent.confirm', { confirmationId: ctx.confirmationId, approved: true }) : null;
    case 'confirm.deny':
      return ctx.confirmationId ? ipc('agent.confirm', { confirmationId: ctx.confirmationId, approved: false }) : null;
    case 'confirm.batchApprove':
      return ctx.confirmationId
        ? ipc('agent.confirm', {
            confirmationId: ctx.confirmationId,
            approved: true,
            ...(ctx.deniedIndices?.length ? { deniedIndices: ctx.deniedIndices } : {}),
          })
        : null;
    case 'confirm.batchDeny':
      return ctx.confirmationId ? ipc('agent.confirm', { confirmationId: ctx.confirmationId, approved: false }) : null;
    case 'confirm.cancelWindow':
      return ctx.turnId ? ipc('agent.cancel', { turnId: ctx.turnId }) : null;

    case 'ringing.dismiss':
      return ctx.alert ? ipc('alert.action', { kind: ctx.alert.kind, id: ctx.alert.id, action: 'dismiss' }) : null;
    case 'ringing.complete':
      // Reminder-only: marks the reminder itself done, unlike dismiss which
      // only closes the card.
      return ctx.alert ? ipc('alert.action', { kind: ctx.alert.kind, id: ctx.alert.id, action: 'complete' }) : null;
    case 'ringing.snooze':
      return ctx.alert
        ? ipc('alert.action', {
            kind: ctx.alert.kind,
            id: ctx.alert.id,
            action: 'snooze',
            ...(ctx.snoozeMin ? { snoozeMin: ctx.snoozeMin } : {}),
          })
        : null;

    case 'nudge.action':
      return ctx.suggestionId && ctx.actionId
        ? ipc('suggestion.action', { suggestionId: ctx.suggestionId, actionId: ctx.actionId })
        : null;
    case 'nudge.dismissFirstRunNote':
      return local('hides a one-time explainer; the suggestion itself is untouched');

    case 'recall.openNote':
      return ctx.noteId ? ipc('workspace.open', { view: 'notes', noteId: ctx.noteId }) : null;

    // K1: these two re-enter the agent, so they must continue the conversation
    // the card belongs to. They used to mint a synthetic convId per subject or
    // per message id, which orphaned the turn — its confirm card and its memory
    // landed in a thread the user could never open.
    case 'email.sendDraft':
    case 'email.loadImages':
      return ctx.text && ctx.convId
        ? ipc('agent.userMessage', { text: ctx.text, source: 'text', convId: ctx.convId })
        : null;

    case 'sync.resolveConflict':
      return ctx.eventId && ctx.choice ? ipc('google.resolveConflict', { eventId: ctx.eventId, choice: ctx.choice }) : null;

    case 'timer.cancel':
      return ctx.id ? ipc('data.mutate', { op: 'cancelTimer', id: ctx.id }) : null;
    case 'event.delete':
      return ctx.id ? ipc('data.mutate', { op: 'deleteEvent', id: ctx.id }) : null;

    default:
      return null;
  }
}

/** Sends a control's dispatch, if it has one. Returns whether IPC was sent. */
export async function fireControl(id: string, ctx: ControlContext = {}): Promise<boolean> {
  const d = controlDispatch(id, ctx);
  if (!d || d.kind !== 'ipc') return false;
  // The registry types each payload against its channel above; the call site is
  // generic over all channels, so this cast is the one place it is unavoidable.
  await (window.apollo.call as (c: InvokeChannelName, p: unknown) => Promise<unknown>)(d.channel, d.payload);
  return true;
}
