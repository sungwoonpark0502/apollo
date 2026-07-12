import { type WakeAdapter } from './adapter';

/**
 * FakeWake (C17): never self-triggers from audio. debug.wake is short-circuited
 * in main straight into the VoiceController, so this adapter stays inert; the
 * trigger() hook exists for worker-level tests.
 */
export class FakeWake implements WakeAdapter {
  private onWake: (() => void) | null = null;

  start(onWake: () => void): void {
    this.onWake = onWake;
  }
  stop(): void {
    this.onWake = null;
  }
  setSensitivity(_v: number): void {
    /* no-op */
  }
  process(_pcm: Int16Array, _gated: boolean): void {
    /* audio never triggers the fake */
  }
  trigger(): void {
    this.onWake?.();
  }
}
