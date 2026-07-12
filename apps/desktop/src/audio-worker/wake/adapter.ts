/** C12.4 wake adapter contract. Frame-driven engines consume 512-sample Int16 frames. */
export interface WakeAdapter {
  start(onWake: () => void): Promise<void> | void;
  stop(): void;
  setSensitivity(v: number): void;
  /** Called per audio frame while listening passively (and gated, with a raised threshold). */
  process(pcm: Int16Array, gated: boolean): void;
}
