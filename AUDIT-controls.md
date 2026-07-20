# AUDIT-controls.md — orb-surface control dispatch audit (L3.2)

Every interactive control on the orb, Stage cards, confirm/batch cards, the
ringing overlay, and nudge cards, traced to the IPC channel it actually
dispatches, with the test that proves it.

The working assumption for this audit, per the phase brief, was that some
controls did nothing against real flows because they had only ever been
exercised with Fake adapters. That assumption held: four defects are recorded in
[Defects found and fixed](#defects-found-and-fixed).

## Method

Rendering a control and observing a Fake adapter respond proves the handler
ran, not that anything crossed the IPC boundary. So the dispatch was extracted
out of JSX into a registry, [`controlDispatch.ts`](apps/desktop/src/renderer/lib/controlDispatch.ts),
which resolves a control id plus its context to one of:

- `{ kind: 'ipc', channel, payload }` — the exact message that goes on the wire.
- `{ kind: 'local', why }` — the control is deliberately renderer-local, with a
  stated reason. Local is a documented answer, not a missing one.
- `null` — the control is correctly inert for that context (no turn in flight,
  no deep link on this card kind), which the tests assert case by case.

[`controlDispatch.test.ts`](apps/desktop/src/renderer/lib/controlDispatch.test.ts)
asserts the channel and payload for every entry. Three tests keep the audit from
rotting:

1. **Coverage** — every control in the registry resolves under a full context;
   an entry that resolves to `null` there is unwired and fails the suite.
2. **Documentation** — every control id appears in this file.
3. **No inline dispatch** — no component under `windows/orb/`, `components/cards/`,
   or the four card components calls `window.apollo.call` directly. A control
   wired inline would bypass both the registry and every test above, so this is
   the guard that makes the table below trustworthy rather than aspirational.

## Coverage table

### Orb menu (right-click)

| Control | id | Dispatch |
| --- | --- | --- |
| Open chat | `orb.menu.openChat` | `workspace.open` `{ view: 'chat', convId? }` — carries the turn's conversation |
| Open Apollo | `orb.menu.openApollo` | `workspace.open` `{ view: 'today' }` (L2.4 rail order) |

### Orb thinking / speaking controls

| Control | id | Dispatch |
| --- | --- | --- |
| Cancel | `orb.thinking.cancel` | `agent.cancel` `{ turnId }`; inert with no turn in flight |
| Stop | `orb.tts.stop` | `tts.drained` — flushing audio is local, but the FSM must be told or voice never leaves `speaking` |
| Skip sentence | `orb.tts.skip` | local: advances the playback queue one sentence; the audio is already synthesized |
| Replay | `orb.tts.replay` | local: replays retained buffers of the current reply — no LLM turn, no re-synthesis |

### Cards (panel chrome)

| Control | id | Dispatch |
| --- | --- | --- |
| Open in chat | `card.openInChat` | `workspace.open` `{ view: 'chat', convId }` |
| Pin / unpin | `card.pin` | local: holds the card against auto-dismiss for this panel session (C18) |
| Cancel timer | `timer.cancel` | `data.mutate` `{ op: 'cancelTimer' }` |
| Delete event | `event.delete` | `data.mutate` `{ op: 'deleteEvent' }` |
| Open recalled note | `recall.openNote` | `workspace.open` `{ view: 'notes', noteId }` |
| Send drafted email | `email.sendDraft` | `agent.userMessage` on the card's conversation |
| Load remote images | `email.loadImages` | `agent.userMessage` on the card's conversation |
| Resolve sync conflict | `sync.resolveConflict` | `google.resolveConflict` `{ eventId, choice }` |

### Stage cards

| Control | id | Dispatch |
| --- | --- | --- |
| Open in Apollo | `stage.openInApollo` | `workspace.open` with the card's deep link; absent for kinds with no destination |
| News headline | `stage.newsRow` | local: an `https` anchor. `hardenWindow` in `windows.ts` denies the child window and routes it to `shell.openExternal`, so it opens in the system browser and never in-app |

### Confirm and batch confirm (C11 gate)

| Control | id | Dispatch |
| --- | --- | --- |
| Confirm | `confirm.approve` | `agent.confirm` `{ confirmationId, approved: true }` |
| Cancel | `confirm.deny` | `agent.confirm` `{ confirmationId, approved: false }` |
| Confirm batch | `confirm.batchApprove` | `agent.confirm` with `deniedIndices` for per-item denials |
| Cancel batch | `confirm.batchDeny` | `agent.confirm` `{ approved: false }` |
| Undo (cancel window) | `confirm.cancelWindow` | `agent.cancel` `{ turnId }` |

The gate is only as strong as the id binding, so a dedicated test asserts that
no approval dispatch can be constructed without a `confirmationId`.

### Ringing overlay

| Control | id | Dispatch |
| --- | --- | --- |
| Dismiss | `ringing.dismiss` | `alert.action` `{ kind, id, action: 'dismiss' }` |
| Done (reminder only) | `ringing.complete` | `alert.action` `{ kind, id, action: 'complete' }` |
| Snooze (5 / 10 / 15) | `ringing.snooze` | `alert.action` with that preset's `snoozeMin`; omitted lets main apply the per-kind default |

### Nudge cards

| Control | id | Dispatch |
| --- | --- | --- |
| Per-suggestion action | `nudge.action` | `suggestion.action` `{ suggestionId, actionId }` |
| Dismiss first-nudge explainer | `nudge.dismissFirstRunNote` | local: hides a one-time explainer; the suggestion itself is untouched |

## Defects found and fixed

**1. "Skip sentence" did not exist.** `STRINGS.orbControls.skip` was defined and
referenced zero times. There was no button and no handler anywhere in the TTS
path, so the I5 affordance was absent from the product while appearing complete
in the string table. The playback queue has been rebuilt to retain decoded
buffers per sentence, and `skipSentence()` is wired to a real control.

**2. "Replay" spent an LLM turn to replay audio the client already had.** It
sent `agent.userMessage` with the text `"repeat that"`, so replaying a sentence
cost a model round trip, a fresh TTS synthesis, and a visible turn in the
conversation. It also hardcoded `convId: 'orb'`, which is not a real
conversation, so the turn was orphaned from the shared thread that K1 requires.
Replay now schedules the retained buffers from index 0 with no IPC at all.

**3. Two card actions minted synthetic conversation ids.** `DraftCard` sent its
"send that draft" message with ``convId: `draft-${subject}` `` and
`EmailDetailCard` used ``convId: `card-${email.id}` ``. Both invented a
conversation per subject or per message id, so the resulting turn — including
the confirm card for actually sending the mail — landed in a thread with no
entry point in the sidebar. Both now take the card's conversation from props and
dispatch nothing when there is none.

**4. Two `data.mutate` ops had no dispatcher at all.** `completeTodo` outlived
the To-dos surface removed in L2.4, and `pinCard` was a round trip to a `break;`
because pinning is renderer-local state. Both are removed from
`dataMutateSchema` and from the handler.

## Known gap, not fixed here

`snoozeReminder` and `completeReminder` remain in `dataMutateSchema` with
working repo methods and no control that dispatches them. Reminders currently
surface as a plain OS notification with no actions, and the inline reminder
actions E3.1 describes lived on surfaces that L2.4 removed. Unlike the four
defects above, closing this gap means adding UI, which is outside L3.2's scope —
so it is recorded here and in HUMAN_TODO.md rather than being silently deleted
along with the genuinely dead ops.


## Follow-up: the reminder gap is closed

The original audit recorded `snoozeReminder` / `completeReminder` as working
repo methods reachable by no control, because reminders fired as a bare OS
notification and the inline actions E3.1 described lived on the To-dos surface
L2.4 removed. That is now fixed, and the fix reused the audited machinery rather
than adding a fourth alert surface: a fired reminder raises the same orb card
timers and alarms use, with `alert.action` widened to carry `kind: 'reminder'`
and a new `complete` action.

Two behaviors are deliberate:

- **A reminder never rings.** `ringState` returns `{ looping: false, gain: 0 }`
  for it and the card skips the audio element entirely. A reminder is a prompt,
  not an alarm, and one that made noise would train people to dismiss it fast.
- **Dismiss does not complete.** "Not now" closes the card and leaves the
  reminder pending; only "Done" calls `reminders.complete`. Treating a dismissed
  popup as a finished task is how reminders quietly disappear unfinished.

Snooze presets differ by kind for the same reason — 1/5/10 minutes suits a
timer, 10/30/60 suits a reminder.
