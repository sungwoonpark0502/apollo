import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { WorkerToMain } from '@apollo/shared';
import { SileroVad, createSileroProbFn } from './vad/silero';
import { createWorkerCore } from './core';
import { FakeWake } from './wake/fake';
import { buildWav, parseWav, wavToFrames } from '../main/voice/wav';

function frame(fill = 0): Int16Array {
  return new Int16Array(512).fill(fill);
}

describe('SileroVad hangover mechanics (stubbed model)', () => {
  it('flips on immediately, off only after 300ms of silence', async () => {
    const probs: number[] = [0.9, 0.9, 0.1, 0.1, 0.9, ...Array<number>(20).fill(0.1)];
    const vad = new SileroVad(async () => probs.shift() ?? 0.1);

    expect(await vad.process(frame())).toEqual({ speech: true }); // 0.9
    expect(await vad.process(frame())).toBeNull(); // still speaking
    expect(await vad.process(frame())).toBeNull(); // silence 1 (hangover)
    expect(await vad.process(frame())).toBeNull(); // silence 2
    expect(await vad.process(frame())).toBeNull(); // speech again resets hangover

    // now 10 consecutive silent frames (~320ms) end speech
    let transition = null;
    for (let i = 0; i < 10; i++) transition = await vad.process(frame());
    expect(transition).toEqual({ speech: false });
  });

  it('int16→float32 conversion is unit-scaled', () => {
    const f = SileroVad.int16ToFloat32(Int16Array.from([0, 16384, -32768]));
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(0.5, 2);
    expect(f[2]).toBeCloseTo(-1, 2);
  });
});

describe('Silero onnx integration', () => {
  it('loads the bundled model; silence scores far below the 0.5 threshold', async () => {
    const probFn = await createSileroProbFn(join(__dirname, '../../resources/silero_vad.onnx'));
    const p = await probFn(new Float32Array(512));
    expect(p).toBeLessThan(0.1);
  });
});

describe('worker core mode machine (C12.2)', () => {
  function setup(): { core: ReturnType<typeof createWorkerCore>; sent: WorkerToMain[]; wake: FakeWake; gatedFrames: boolean[] } {
    const sent: WorkerToMain[] = [];
    const gatedFrames: boolean[] = [];
    const wake = new (class extends FakeWake {
      override process(_pcm: Int16Array, gated: boolean): void {
        gatedFrames.push(gated);
      }
    })();
    const vad = new SileroVad(async () => 0.9); // always speech
    const core = createWorkerCore({ wake, vad, send: (m) => sent.push(m) });
    return { core, sent, wake, gatedFrames };
  }

  it('passive: wake runs, nothing forwarded; wake fires {t:wake}', async () => {
    const { core, sent, wake, gatedFrames } = setup();
    await core.frame(frame());
    expect(sent).toHaveLength(0);
    expect(gatedFrames).toEqual([false]);
    wake.trigger();
    expect(sent).toEqual([{ t: 'wake' }]);
  });

  it('stream: frames forwarded + vad transition emitted', async () => {
    const { core, sent } = setup();
    core.control({ t: 'mode', mode: 'stream' });
    await core.frame(frame(100));
    const types = sent.map((m) => m.t);
    expect(types).toContain('frame');
    expect(sent.find((m) => m.t === 'vad')).toEqual({ t: 'vad', speech: true });
    const f = sent.find((m) => m.t === 'frame') as Extract<WorkerToMain, { t: 'frame' }>;
    expect(new Int16Array(f.pcm)[0]).toBe(100);
  });

  it('gated: wake runs with the raised threshold flag, no forwarding', async () => {
    const { core, sent, gatedFrames } = setup();
    core.control({ t: 'mode', mode: 'gated' });
    await core.frame(frame());
    expect(sent).toHaveLength(0);
    expect(gatedFrames).toEqual([true]);
  });

  it('mute drops everything until unmuted', async () => {
    const { core, sent } = setup();
    core.control({ t: 'mode', mode: 'stream' });
    core.control({ t: 'mute', on: true });
    await core.frame(frame());
    expect(sent).toHaveLength(0);
    expect(core.modeOf()).toBe('muted');
    core.control({ t: 'mute', on: false });
    await core.frame(frame());
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe('wav parsing for debug.injectAudio (A2.2a)', () => {
  it('round-trips 16k mono 16-bit and frames into 512 samples zero-padded', () => {
    const samples = new Int16Array(1200).map((_, i) => (i % 2 ? 1000 : -1000));
    const wav = buildWav(samples);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.samples).toHaveLength(1200);

    const dir = join(tmpdir(), 'apollo-wav-test');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'fixture.wav');
    writeFileSync(p, wav);
    const frames = wavToFrames(p);
    expect(frames).toHaveLength(3); // 1200/512 → 3 frames
    expect(frames[2]!.at(-1)).toBe(0); // padded tail
  });

  it('rejects non-wav and wrong sample rates', () => {
    expect(() => parseWav(Buffer.from('not a wav file at all........'))).toThrow(/not a WAV/);
    const dir = join(tmpdir(), 'apollo-wav-test');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'bad-rate.wav');
    writeFileSync(p, buildWav(new Int16Array(100), 44_100));
    expect(() => wavToFrames(p)).toThrow(/16000Hz/);
  });

  it('downmixes stereo to mono', () => {
    const stereo = new Int16Array(200);
    for (let i = 0; i < 100; i++) {
      stereo[i * 2] = 1000;
      stereo[i * 2 + 1] = 3000;
    }
    const buf = buildWav(stereo);
    buf.writeUInt16LE(2, 22); // channels = 2
    const parsed = parseWav(buf);
    expect(parsed.samples).toHaveLength(100);
    expect(parsed.samples[0]).toBe(2000);
  });
});
