import { AUDIO } from '@apollo/shared';

/**
 * Silero VAD (C12.2): 0.5 threshold with a 300ms hangover — speech turns off
 * only after ~10 consecutive sub-threshold frames (512 samples = 32ms each).
 */
export type SpeechProbFn = (frame: Float32Array) => Promise<number>;

const FRAME_MS = (AUDIO.frameSamples / AUDIO.sampleRate) * 1000; // 32ms
const HANGOVER_FRAMES = Math.ceil(300 / FRAME_MS);

export interface VadTransition {
  speech: boolean;
}

export class SileroVad {
  private speaking = false;
  private silentFrames = 0;

  constructor(
    private readonly probOf: SpeechProbFn,
    private readonly threshold = 0.5,
  ) {}

  static int16ToFloat32(pcm: Int16Array): Float32Array {
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] as number) / 32768;
    return out;
  }

  /** Returns a transition when the speech state flips, else null. */
  async process(pcm: Int16Array): Promise<VadTransition | null> {
    const prob = await this.probOf(SileroVad.int16ToFloat32(pcm));
    if (prob >= this.threshold) {
      this.silentFrames = 0;
      if (!this.speaking) {
        this.speaking = true;
        return { speech: true };
      }
      return null;
    }
    if (!this.speaking) return null;
    this.silentFrames += 1;
    if (this.silentFrames >= HANGOVER_FRAMES) {
      this.speaking = false;
      this.silentFrames = 0;
      return { speech: false };
    }
    return null;
  }

  reset(): void {
    this.speaking = false;
    this.silentFrames = 0;
  }
}

/** Real onnxruntime-backed probability function (Silero v5 signature: input/state/sr → output/stateN). */
export async function createSileroProbFn(modelPath: string): Promise<SpeechProbFn> {
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath);
  let state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(AUDIO.sampleRate)]), []);
  return async (frame) => {
    const out = await session.run({
      input: new ort.Tensor('float32', frame, [1, frame.length]),
      state,
      sr,
    });
    state = out['stateN'] as typeof state;
    return (out['output']!.data as Float32Array)[0] as number;
  };
}
