import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceState } from '@apollo/shared';
import { createVoiceController, type VoiceController, type VoiceControllerDeps } from './voiceController';
import { FakeStt, type FakeSttFixture } from './sttFake';
import { type SttAdapter } from './stt';

interface Harness {
  vc: VoiceController;
  states: VoiceState[];
  partials: Array<{ transcript: string; rms: number }>;
  dispatched: string[];
  earcons: string[];
  modes: string[];
  ttsStops: number[];
  stt: FakeStt;
}

const TIMER_FIXTURE: FakeSttFixture = {
  steps: [
    { delayMs: 200, partial: 'set a' },
    { delayMs: 200, partial: 'set a timer' },
    { delayMs: 300, partial: 'set a timer for 5 minutes', final: true },
  ],
};

function harness(fixtures: FakeSttFixture[] = [TIMER_FIXTURE, TIMER_FIXTURE], adapter?: SttAdapter): Harness {
  const h = {
    states: [] as VoiceState[],
    partials: [] as Array<{ transcript: string; rms: number }>,
    dispatched: [] as string[],
    earcons: [] as string[],
    modes: [] as string[],
    ttsStops: [] as number[],
  };
  const stt = new FakeStt(fixtures);
  const deps: VoiceControllerDeps = {
    stt: adapter ?? stt,
    workerSend: (m) => {
      if (m.t === 'mode') h.modes.push(m.mode);
      else h.modes.push(m.on ? 'MUTE' : 'UNMUTE');
    },
    dispatch: (t) => h.dispatched.push(t),
    pushState: (s) => h.states.push(s),
    pushPartial: (transcript, rms) => h.partials.push({ transcript, rms }),
    playEarcon: (n) => h.earcons.push(n),
    stopTts: () => {
      h.ttsStops.push(1);
    },
  };
  return { vc: createVoiceController(deps), stt, ...h };
}

function frameMsg(fill = 1000): { t: 'frame'; pcm: ArrayBuffer } {
  return { t: 'frame', pcm: new Int16Array(512).fill(fill).buffer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('C12.3 FSM table', () => {
  it('row: idle + wake → listening (wake earcon, STT open, mode=stream)', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    expect(h.vc.state()).toBe('listening');
    expect(h.earcons).toEqual(['wake']);
    expect(h.modes).toContain('stream');
    expect(h.stt.openCount).toBe(1);
  });

  it('row: hotkey / PTT is a wake-free entry to listening', async () => {
    const h = harness();
    h.vc.onHotkey();
    await flush();
    expect(h.vc.state()).toBe('listening');
  });

  it('row: stt partial → voice.partial pushes (transcript + rms)', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    h.vc.onWorkerMessage(frameMsg(3277)); // ~0.1 rms
    await vi.advanceTimersByTimeAsync(450);
    expect(h.partials.length).toBeGreaterThan(0);
    expect(h.partials.at(-1)?.transcript).toContain('set a timer');
    expect(h.partials.at(-1)?.rms).toBeGreaterThan(0.05);
  });

  it('row: EOT via provider endpoint → thinking, socket closed, final dispatched', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(800); // fixture final at 700ms fires endpoint
    expect(h.vc.state()).toBe('thinking');
    expect(h.dispatched).toEqual(['set a timer for 5 minutes']);
    expect(h.modes.at(-1)).toBe('passive');
  });

  it('row: EOT via VAD silence 600ms wins when the provider endpoint never comes', async () => {
    const fixture: FakeSttFixture = { steps: [{ delayMs: 100, partial: 'note that milk is out' }] }; // no final/endpoint
    const h = harness([fixture]);
    h.vc.onWake();
    await flush();
    h.vc.onWorkerMessage({ t: 'vad', speech: true });
    await vi.advanceTimersByTimeAsync(150);
    h.vc.onWorkerMessage({ t: 'vad', speech: false });
    await vi.advanceTimersByTimeAsync(599);
    expect(h.vc.state()).toBe('listening');
    await vi.advanceTimersByTimeAsync(2);
    expect(h.vc.state()).toBe('thinking');
    expect(h.dispatched).toEqual(['note that milk is out']);
  });

  it('row: 4s with no speech → idle, end earcon, no LLM call', async () => {
    const h = harness([{ steps: [] }]);
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(4_001);
    expect(h.vc.state()).toBe('idle');
    expect(h.dispatched).toHaveLength(0);
    expect(h.earcons).toEqual(['wake', 'done']);
  });

  it('row: 30s hard cap → thinking with whatever transcribed', async () => {
    const fixture: FakeSttFixture = { steps: [{ delayMs: 100, partial: 'a very long ramble' }] };
    const h = harness([fixture]);
    h.vc.onWake();
    await flush();
    h.vc.onWorkerMessage({ t: 'vad', speech: true }); // keeps the 4s timer away
    await vi.advanceTimersByTimeAsync(30_001);
    expect(h.vc.state()).toBe('thinking');
    expect(h.dispatched).toEqual(['a very long ramble']);
  });

  it('row: thinking + first TTS chunk → speaking, worker gated', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(800);
    expect(h.vc.state()).toBe('thinking');
    h.vc.ttsStarted();
    expect(h.vc.state()).toBe('speaking');
    expect(h.modes.at(-1)).toBe('gated');
  });

  it('row: thinking + text-only reply done → idle', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(800);
    h.vc.turnDone();
    expect(h.vc.state()).toBe('idle');
  });

  it('row: speaking + VAD speech (barge-in) → tts stopped, STT reopened, mode stream', async () => {
    const h = harness([TIMER_FIXTURE, TIMER_FIXTURE]);
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(800);
    h.vc.ttsStarted();
    expect(h.vc.state()).toBe('speaking');

    h.vc.onWorkerMessage({ t: 'vad', speech: true });
    await flush();
    expect(h.ttsStops.length).toBeGreaterThanOrEqual(1);
    expect(h.vc.state()).toBe('listening');
    expect(h.stt.openCount).toBe(2);
    expect(h.modes.at(-1)).toBe('stream');
  });

  it('row: speaking + playback drained → idle, mode passive', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    await vi.advanceTimersByTimeAsync(800);
    h.vc.ttsStarted();
    h.vc.ttsFinished();
    expect(h.vc.state()).toBe('idle');
    expect(h.modes.at(-1)).toBe('passive');
  });

  it('row: mute from any state → muted (capture stopped), unmute restores', async () => {
    const h = harness();
    h.vc.onWake();
    await flush();
    h.vc.setMuted(true);
    expect(h.vc.state()).toBe('muted');
    expect(h.modes).toContain('MUTE');
    // wake while muted is ignored
    h.vc.onWake();
    await flush();
    expect(h.vc.state()).toBe('muted');
    h.vc.setMuted(false);
    expect(h.vc.state()).toBe('idle');
  });

  it('empty transcript at EOT returns to idle without dispatch', async () => {
    const fixture: FakeSttFixture = { steps: [] };
    const h = harness([fixture]);
    h.vc.onWake();
    await flush();
    h.vc.onWorkerMessage({ t: 'vad', speech: true });
    h.vc.onWorkerMessage({ t: 'vad', speech: false });
    await vi.advanceTimersByTimeAsync(601);
    expect(h.vc.state()).toBe('idle');
    expect(h.dispatched).toHaveLength(0);
  });

  it('two consecutive STT failures degrade to error state (voice off, text on)', async () => {
    const failing: SttAdapter = {
      open: async () => {
        throw new Error('no socket');
      },
    };
    const h = harness([], failing);
    h.vc.onWake();
    await flush();
    expect(h.vc.state()).toBe('idle'); // first failure: retry allowed
    h.vc.onWake();
    await flush();
    expect(h.vc.state()).toBe('error');
    expect(h.vc.isVoiceDisabled()).toBe(true);
    h.vc.onWake();
    await flush();
    expect(h.vc.state()).toBe('error'); // stays disabled
  });
});
