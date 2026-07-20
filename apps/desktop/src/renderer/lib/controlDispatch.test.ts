import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { controlDispatch, fireControl, ORB_CONTROLS, type Dispatch } from './controlDispatch';

/**
 * L3.2: every control on the orb surfaces must reach a real IPC dispatch. The
 * premise of this file is that rendering a control with Fake adapters proves
 * nothing — the handler runs, the wire stays empty. So each case asserts the
 * exact channel and payload, and the last block asserts the registry is
 * complete, so an unwired control cannot be added quietly.
 */

function ipcOf(d: Dispatch | null): { channel: string; payload: unknown } {
  expect(d).not.toBeNull();
  expect(d!.kind).toBe('ipc');
  const x = d as Extract<Dispatch, { kind: 'ipc' }>;
  return { channel: x.channel, payload: x.payload };
}

describe('L3.2 orb menu', () => {
  it('Open chat carries the conversation the turn belongs to', () => {
    expect(ipcOf(controlDispatch('orb.menu.openChat', { convId: 'c7' }))).toEqual({
      channel: 'workspace.open',
      payload: { view: 'chat', convId: 'c7' },
    });
  });

  it('Open chat with no active conversation opens the tab without one', () => {
    expect(ipcOf(controlDispatch('orb.menu.openChat', {})).payload).toEqual({ view: 'chat' });
  });

  it('Open Apollo lands on Today (L2.4 rail order)', () => {
    expect(ipcOf(controlDispatch('orb.menu.openApollo'))).toEqual({
      channel: 'workspace.open',
      payload: { view: 'today' },
    });
  });
});

describe('L3.2 thinking + TTS controls', () => {
  it('Cancel cancels the specific turn', () => {
    expect(ipcOf(controlDispatch('orb.thinking.cancel', { turnId: 't1' }))).toEqual({
      channel: 'agent.cancel',
      payload: { turnId: 't1' },
    });
  });

  it('Cancel is inert with no turn in flight rather than dispatching a bad id', () => {
    expect(controlDispatch('orb.thinking.cancel', { turnId: null })).toBeNull();
  });

  it('Stop reports the drain so the FSM can leave speaking', () => {
    expect(ipcOf(controlDispatch('orb.tts.stop'))).toEqual({ channel: 'tts.drained', payload: {} });
  });

  it('Skip and Replay are local and, in particular, never spend an LLM turn', () => {
    for (const id of ['orb.tts.skip', 'orb.tts.replay']) {
      const d = controlDispatch(id);
      expect(d?.kind).toBe('local');
    }
    // Regression: Replay used to send "repeat that" as a user message, which
    // cost a turn, re-synthesized the audio, and pinned convId to 'orb',
    // breaking the K1 shared-thread rule.
    expect(JSON.stringify(controlDispatch('orb.tts.replay'))).not.toContain('agent.userMessage');
  });
});

describe('L3.2 cards', () => {
  it('Open in chat deep-links to the card conversation', () => {
    expect(ipcOf(controlDispatch('card.openInChat', { convId: 'c9' }))).toEqual({
      channel: 'workspace.open',
      payload: { view: 'chat', convId: 'c9' },
    });
  });

  it('Stage Open in Apollo forwards the card deep link verbatim', () => {
    expect(ipcOf(controlDispatch('stage.openInApollo', { deepLink: { view: 'calendar', dateIso: '2026-07-18' } }))).toEqual({
      channel: 'workspace.open',
      payload: { view: 'calendar', dateIso: '2026-07-18' },
    });
  });

  it('Stage Open in Apollo is absent for card kinds with no destination', () => {
    expect(controlDispatch('stage.openInApollo', { deepLink: null })).toBeNull();
  });

  it('timer cancel and event delete hit data.mutate with their op', () => {
    expect(ipcOf(controlDispatch('timer.cancel', { id: 'tm1' }))).toEqual({
      channel: 'data.mutate',
      payload: { op: 'cancelTimer', id: 'tm1' },
    });
    expect(ipcOf(controlDispatch('event.delete', { id: 'ev1' }))).toEqual({
      channel: 'data.mutate',
      payload: { op: 'deleteEvent', id: 'ev1' },
    });
  });
});

describe('L3.2 confirmation controls (C11 gate)', () => {
  it('approve and deny both carry the confirmation id and the decision', () => {
    expect(ipcOf(controlDispatch('confirm.approve', { confirmationId: 'k1' })).payload).toEqual({
      confirmationId: 'k1',
      approved: true,
    });
    expect(ipcOf(controlDispatch('confirm.deny', { confirmationId: 'k1' })).payload).toEqual({
      confirmationId: 'k1',
      approved: false,
    });
  });

  it('a batch approval carries the per-item denials', () => {
    expect(ipcOf(controlDispatch('confirm.batchApprove', { confirmationId: 'b1', deniedIndices: [1, 3] })).payload).toEqual({
      confirmationId: 'b1',
      approved: true,
      deniedIndices: [1, 3],
    });
  });

  it('a batch with nothing denied omits the field rather than sending []', () => {
    expect(ipcOf(controlDispatch('confirm.batchApprove', { confirmationId: 'b1', deniedIndices: [] })).payload).toEqual({
      confirmationId: 'b1',
      approved: true,
    });
  });

  it('no control can approve without a confirmation id', () => {
    // The C11 gate is only as good as the id binding: a dispatch with a missing
    // or guessed id must not exist at all.
    for (const id of ['confirm.approve', 'confirm.batchApprove']) {
      expect(controlDispatch(id, {})).toBeNull();
    }
  });

  it('the cancel-window bar cancels the turn it belongs to', () => {
    expect(ipcOf(controlDispatch('confirm.cancelWindow', { turnId: 't4' }))).toEqual({
      channel: 'agent.cancel',
      payload: { turnId: 't4' },
    });
  });
});

describe('L3.2 ringing overlay', () => {
  it('dismiss targets the ringing alert by kind and id', () => {
    expect(ipcOf(controlDispatch('ringing.dismiss', { alert: { kind: 'alarm', id: 'a1' } }))).toEqual({
      channel: 'alert.action',
      payload: { kind: 'alarm', id: 'a1', action: 'dismiss' },
    });
  });

  it('each snooze preset sends its own duration', () => {
    for (const m of [5, 10, 15]) {
      expect(ipcOf(controlDispatch('ringing.snooze', { alert: { kind: 'timer', id: 't1' }, snoozeMin: m })).payload).toEqual({
        kind: 'timer',
        id: 't1',
        action: 'snooze',
        snoozeMin: m,
      });
    }
  });

  it('snooze without a preset lets main apply the per-kind default', () => {
    expect(ipcOf(controlDispatch('ringing.snooze', { alert: { kind: 'alarm', id: 'a1' } })).payload).toEqual({
      kind: 'alarm',
      id: 'a1',
      action: 'snooze',
    });
  });
});

describe('L3.2 card actions that re-enter the agent (K1 shared thread)', () => {
  it('the draft send and the load-images action continue the card conversation', () => {
    // Regression: these minted a synthetic convId per subject and per message
    // id, so the resulting turn — including its confirm card — landed in a
    // conversation the user had no way to open.
    for (const id of ['email.sendDraft', 'email.loadImages']) {
      const { channel, payload } = ipcOf(controlDispatch(id, { text: 'go', convId: 'c3' }));
      expect(channel).toBe('agent.userMessage');
      expect(payload).toEqual({ text: 'go', source: 'text', convId: 'c3' });
    }
  });

  it('neither dispatches when there is no conversation to continue', () => {
    for (const id of ['email.sendDraft', 'email.loadImages']) {
      expect(controlDispatch(id, { text: 'go', convId: null })).toBeNull();
    }
  });

  it('recall opens the note it points at, and conflict resolution carries the choice', () => {
    expect(ipcOf(controlDispatch('recall.openNote', { noteId: 'n4' })).payload).toEqual({ view: 'notes', noteId: 'n4' });
    expect(ipcOf(controlDispatch('sync.resolveConflict', { eventId: 'e1', choice: 'theirs' })).payload).toEqual({
      eventId: 'e1',
      choice: 'theirs',
    });
  });
});

describe('L3.2 nudge cards', () => {
  it('a nudge action reports both the suggestion and which action was taken', () => {
    expect(ipcOf(controlDispatch('nudge.action', { suggestionId: 's1', actionId: 'snooze' }))).toEqual({
      channel: 'suggestion.action',
      payload: { suggestionId: 's1', actionId: 'snooze' },
    });
  });

  it('an action with no suggestion behind it dispatches nothing', () => {
    expect(controlDispatch('nudge.action', { actionId: 'dismiss' })).toBeNull();
  });
});

describe('L3.2 fireControl sends on the real channel', () => {
  it('calls window.apollo.call with the resolved channel and payload', async () => {
    const calls: Array<[string, unknown]> = [];
    (globalThis as unknown as { window: unknown }).window = {
      apollo: {
        call: (c: string, p: unknown) => {
          calls.push([c, p]);
          return Promise.resolve({ ok: true });
        },
      },
    };
    expect(await fireControl('ringing.dismiss', { alert: { kind: 'timer', id: 't2' } })).toBe(true);
    expect(calls).toEqual([['alert.action', { kind: 'timer', id: 't2', action: 'dismiss' }]]);

    // Local controls must not touch IPC at all.
    expect(await fireControl('orb.tts.skip')).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('L3.2 registry coverage', () => {
  it('every listed control resolves to a dispatch under a sufficient context', () => {
    const full = {
      turnId: 't1', convId: 'c1', confirmationId: 'k1', deniedIndices: [0],
      alert: { kind: 'timer' as const, id: 'a1' }, snoozeMin: 5,
      suggestionId: 's1', actionId: 'act', deepLink: { view: 'today' as const }, id: 'x1',
      noteId: 'n1', text: 'do the thing', eventId: 'ev1', choice: 'mine' as const,
    };
    const unwired = ORB_CONTROLS.filter((c) => controlDispatch(c.id, full) === null);
    expect(unwired.map((c) => c.id)).toEqual([]);
  });

  it('control ids are unique', () => {
    const ids = ORB_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('AUDIT-controls.md documents every control in the registry', () => {
    // The audit is the deliverable; keep it from drifting out of date.
    const doc = readFileSync(join(__dirname, '../../../../../AUDIT-controls.md'), 'utf8');
    const missing = ORB_CONTROLS.filter((c) => !doc.includes(c.id));
    expect(missing.map((c) => c.id)).toEqual([]);
  });

  it('no orb-surface component calls apollo.call outside the registry', () => {
    // This is the guard that makes the audit stay true: a control wired inline
    // in JSX bypasses both the registry and these tests.
    const roots = [
      join(__dirname, '../windows/orb'),
      join(__dirname, '../components/cards'),
    ];
    const extras = [
      join(__dirname, '../components/StageCard.tsx'),
      join(__dirname, '../components/NudgeCard.tsx'),
      join(__dirname, '../components/RingingCard.tsx'),
      join(__dirname, '../components/ConfirmBar.tsx'),
    ];
    const files = [...roots.flatMap(walk), ...extras];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (!line.includes('apollo.call(')) continue;
        // settings.get is state the orb reads at mount, not a control dispatch.
        if (line.includes("'settings.get'")) continue;
        if (line.includes('fireControl')) continue;
        offenders.push(`${f.split('/').slice(-2).join('/')}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if ((p.endsWith('.tsx') || p.endsWith('.ts')) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

describe('reminder alert controls (AUDIT follow-up)', () => {
  it('Done completes the reminder rather than only closing the card', () => {
    expect(ipcOf(controlDispatch('ringing.complete', { alert: { kind: 'reminder', id: 'r1' } }))).toEqual({
      channel: 'alert.action',
      payload: { kind: 'reminder', id: 'r1', action: 'complete' },
    });
  });

  it('dismiss stays distinct from complete, so a closed popup is not a done task', () => {
    const dismissed = ipcOf(controlDispatch('ringing.dismiss', { alert: { kind: 'reminder', id: 'r1' } }));
    const completed = ipcOf(controlDispatch('ringing.complete', { alert: { kind: 'reminder', id: 'r1' } }));
    expect(dismissed).not.toEqual(completed);
    expect((dismissed.payload as { action: string }).action).toBe('dismiss');
  });

  it('snooze carries the chosen interval for a reminder', () => {
    expect(ipcOf(controlDispatch('ringing.snooze', { alert: { kind: 'reminder', id: 'r1' }, snoozeMin: 30 }))).toEqual({
      channel: 'alert.action',
      payload: { kind: 'reminder', id: 'r1', action: 'snooze', snoozeMin: 30 },
    });
  });

  it('dispatches nothing without an alert in context', () => {
    expect(controlDispatch('ringing.complete', {})).toBeNull();
  });
});
