import { type TtsAdapter } from './adapter';

/**
 * FakeTTS (C17): logs sentences and emits silent buffers with duration
 * proportional to text length, so timing-sensitive tests behave realistically.
 */
export class FakeTts implements TtsAdapter {
  public readonly spoken: string[] = [];

  constructor(private readonly bytesPerChar = 64) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *synthesize(text: string): AsyncIterable<Buffer> {
    this.spoken.push(text);
    const total = Math.max(256, text.length * this.bytesPerChar);
    const chunk = 1024;
    for (let sent = 0; sent < total; sent += chunk) {
      yield Buffer.alloc(Math.min(chunk, total - sent));
    }
  }
}
