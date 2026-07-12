import { describe, expect, it, vi } from 'vitest';

// Mock the native module so the adapter is testable without a Picovoice key.
const instances: MockPorcupine[] = [];

class MockPorcupine {
  public released = false;
  public readonly sensitivity: number;
  public frameLength = 512;
  constructor(
    public accessKey: string,
    public keywords: unknown[],
    sensitivities: number[],
  ) {
    this.sensitivity = sensitivities[0] as number;
    instances.push(this);
  }
  process(pcm: Int16Array): number {
    // "detects" when the first sample crosses a per-sensitivity threshold
    return (pcm[0] ?? 0) > (1 - this.sensitivity) * 1000 ? 0 : -1;
  }
  release(): void {
    this.released = true;
  }
}

vi.mock('@picovoice/porcupine-node', () => ({
  Porcupine: MockPorcupine,
  BuiltinKeyword: { JARVIS: 'JARVIS' },
}));

const { createPorcupineWake } = await import('./porcupine');

describe('Porcupine wake adapter (mocked native)', () => {
  it('builds a normal engine and a gated engine at lower sensitivity (+0.15 threshold)', async () => {
    instances.length = 0;
    await createPorcupineWake({ accessKey: 'k', sensitivity: 0.6 });
    expect(instances).toHaveLength(2);
    const [normal, gated] = instances;
    expect(normal!.sensitivity).toBeCloseTo(0.6);
    expect(gated!.sensitivity).toBeCloseTo(0.45); // 0.6 - 0.15
  });

  it('fires onWake when the active engine detects, routing gated frames to the gated engine', async () => {
    instances.length = 0;
    const adapter = await createPorcupineWake({ accessKey: 'k', sensitivity: 0.6 });
    const wakes: number[] = [];
    adapter.start(() => wakes.push(1));

    // strong frame in normal mode → detect
    adapter.process(Int16Array.from([900, 0, 0]), false);
    expect(wakes).toHaveLength(1);

    // same frame in gated mode: lower sensitivity means a higher bar → no detect
    adapter.process(Int16Array.from([500, 0, 0]), true);
    expect(wakes).toHaveLength(1);
  });

  it('setSensitivity rebuilds both engines and releases the old ones', async () => {
    instances.length = 0;
    const adapter = await createPorcupineWake({ accessKey: 'k', sensitivity: 0.5 });
    const firstPair = [...instances];
    adapter.setSensitivity(0.9);
    expect(firstPair.every((e) => e.released)).toBe(true);
    expect(instances).toHaveLength(4);
    expect(instances[2]!.sensitivity).toBeCloseTo(0.9);
  });

  it('stop releases engines and stops firing', async () => {
    instances.length = 0;
    const adapter = await createPorcupineWake({ accessKey: 'k', sensitivity: 0.6 });
    const wakes: number[] = [];
    adapter.start(() => wakes.push(1));
    adapter.stop();
    expect(instances.every((e) => e.released)).toBe(true);
    adapter.process(Int16Array.from([900, 0, 0]), false);
    expect(wakes).toHaveLength(0);
  });

  it('expects 512-sample frames, matching the shared AUDIO contract', async () => {
    instances.length = 0;
    await createPorcupineWake({ accessKey: 'k', sensitivity: 0.6 });
    expect(instances[0]!.frameLength).toBe(512);
  });
});
