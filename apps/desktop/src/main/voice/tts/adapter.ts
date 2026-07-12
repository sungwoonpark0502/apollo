/** TTS adapter boundary (C12.5): edge and FakeTTS implement this. */
export interface TtsAdapter {
  /** Synthesizes one sentence into a stream of mp3 chunks. */
  synthesize(text: string, signal?: AbortSignal): AsyncIterable<Buffer>;
}
