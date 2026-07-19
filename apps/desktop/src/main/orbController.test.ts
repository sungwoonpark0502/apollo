import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrbController, type OrbIdleMode, type OrbWindowLike } from './orbController';

/**
 * L3.1: the orb must be INVISIBLE when idle by default, appearing only on wake
 * word, push-to-talk, or a nudge/alert, and hiding again when the interaction
 * ends. These assert the real window visibility state, per L7.
 */
class FakeOrbWindow implements OrbWindowLike {
  visible = false;
  destroyed = false;
  ignoreMouse = true;
  showInactiveCalls = 0;
  /** Set if anything ever calls a focus-stealing show; must stay false. */
  focusStealingShow = 0;

  isDestroyed(): boolean {
    return this.destroyed;
  }
  setIgnoreMouseEvents(ignore: boolean): void {
    this.ignoreMouse = ignore;
  }
  showInactive(): void {
    this.visible = true;
    this.showInactiveCalls += 1;
  }
  show(): void {
    this.visible = true;
    this.focusStealingShow += 1;
  }
  hide(): void {
    this.visible = false;
  }
  isVisible(): boolean {
    return this.visible;
  }
}

let win: FakeOrbWindow;
let mode: OrbIdleMode;

function controller(lingerMs = 1000) {
  return createOrbController(win, { lingerMs, idleMode: () => mode });
}

beforeEach(() => {
  vi.useFakeTimers();
  win = new FakeOrbWindow();
  mode = 'hidden';
});
afterEach(() => vi.useRealTimers());

describe('L3.1 idle visibility (default: hidden)', () => {
  it('is not shown at boot', () => {
    const orb = controller();
    expect(orb.isVisible()).toBe(false);
    expect(win.visible).toBe(false);
    expect(win.showInactiveCalls).toBe(0);
  });

  it('appears on wake word / PTT (voice becomes listening) and never steals focus', () => {
    const orb = controller();
    orb.onVoiceState('listening');
    expect(orb.isVisible()).toBe(true);
    expect(win.showInactiveCalls).toBe(1);
    expect(win.focusStealingShow).toBe(0); // showInactive only
    expect(win.ignoreMouse).toBe(false); // interactive while active
  });

  it('stays visible through the whole voice turn, then hides after the linger', () => {
    const orb = controller(1000);
    orb.onVoiceState('listening');
    orb.onVoiceState('thinking');
    orb.onVoiceState('speaking');
    expect(orb.isVisible()).toBe(true);

    orb.onVoiceState('idle');
    expect(orb.isVisible()).toBe(true); // card lingers so it can be read/clicked
    vi.advanceTimersByTime(999);
    expect(orb.isVisible()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(orb.isVisible()).toBe(false); // gone once the linger elapses
    expect(win.ignoreMouse).toBe(true); // and click-through again
  });

  it('a typed turn (no voice) also shows and then hides', () => {
    const orb = controller(1000);
    orb.onAgentEvent({ type: 'turnStart', turnId: 't1', convId: 'c1' });
    expect(orb.isVisible()).toBe(true);
    orb.onAgentEvent({ type: 'done', turnId: 't1' });
    vi.advanceTimersByTime(1001);
    expect(orb.isVisible()).toBe(false);
  });

  it('an errored turn still releases the orb', () => {
    const orb = controller(1000);
    orb.onAgentEvent({ type: 'turnStart', turnId: 't1', convId: 'c1' });
    orb.onAgentEvent({ type: 'error', code: 'LLM_DOWN', userMessage: 'x' });
    vi.advanceTimersByTime(1001);
    expect(orb.isVisible()).toBe(false);
  });
});

describe('L3.1 attention (nudge / ringing alert)', () => {
  it('a nudge surfaces the orb and holds it until released', () => {
    const orb = controller(1000);
    orb.setAttention(true);
    expect(orb.isVisible()).toBe(true);
    expect(win.ignoreMouse).toBe(false); // clickable: the user must reach its actions

    vi.advanceTimersByTime(10_000);
    expect(orb.isVisible()).toBe(true); // no timeout while attention is held

    orb.setAttention(false);
    vi.advanceTimersByTime(1001);
    expect(orb.isVisible()).toBe(false);
  });

  it('an alert during a voice turn keeps the orb up after the turn ends', () => {
    const orb = controller(1000);
    orb.onVoiceState('listening');
    orb.setAttention(true); // alarm rings mid-turn
    orb.onVoiceState('idle');
    vi.advanceTimersByTime(5000);
    expect(orb.isVisible()).toBe(true); // the alert still holds it
    orb.setAttention(false);
    vi.advanceTimersByTime(1001);
    expect(orb.isVisible()).toBe(false);
  });
});

describe('L3.1 orbIdleMode: dot (opt-in)', () => {
  it('stays visible while idle when the user opts into the dot', () => {
    mode = 'dot';
    const orb = controller(1000);
    expect(orb.isVisible()).toBe(true); // shown at boot in dot mode
    orb.onVoiceState('listening');
    orb.onVoiceState('idle');
    vi.advanceTimersByTime(5000);
    expect(orb.isVisible()).toBe(true); // never hides
    expect(win.ignoreMouse).toBe(true); // but is click-through when idle
  });

  it('refresh() applies a live switch from dot to hidden', () => {
    mode = 'dot';
    const orb = controller(1000);
    expect(orb.isVisible()).toBe(true);
    mode = 'hidden';
    orb.refresh();
    expect(orb.isVisible()).toBe(false);
  });

  it('refresh() applies a live switch from hidden to dot', () => {
    const orb = controller(1000);
    expect(orb.isVisible()).toBe(false);
    mode = 'dot';
    orb.refresh();
    expect(orb.isVisible()).toBe(true);
  });
});

describe('L3.1 robustness', () => {
  it('does nothing once the window is destroyed', () => {
    const orb = controller();
    win.destroyed = true;
    orb.onVoiceState('listening');
    expect(orb.isVisible()).toBe(false);
    expect(win.visible).toBe(false);
  });

  it('a second turn cancels a pending hide rather than blinking', () => {
    const orb = controller(1000);
    orb.onVoiceState('listening');
    orb.onVoiceState('idle'); // linger starts
    vi.advanceTimersByTime(500);
    orb.onVoiceState('listening'); // user speaks again mid-linger
    vi.advanceTimersByTime(2000);
    expect(orb.isVisible()).toBe(true); // still up: the old timer was cancelled
  });

  it('hidden ≠ muted: visibility never touches the audio worker', () => {
    // Guard on the contract itself — the controller has no worker dependency,
    // so wake detection keeps running while the window is hidden (L3.1).
    const orb = controller();
    expect(Object.keys(orb)).not.toContain('workerSend');
    expect(orb.isVisible()).toBe(false);
  });
});
