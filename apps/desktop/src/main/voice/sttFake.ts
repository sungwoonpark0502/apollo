import { type SttAdapter, type SttCallbacks, type SttSession } from './stt';

/**
 * FakeSTT (C17): replays fixture sequences of {delayMs, partial} rows ending
 * in a final. Emits the endpoint event after the final, like Deepgram does.
 */
export interface FakeSttFixture {
  steps: Array<{ delayMs: number; partial: string; final?: boolean }>;
}

export class FakeStt implements SttAdapter {
  public openCount = 0;
  private queue: FakeSttFixture[];

  constructor(fixtures: FakeSttFixture[]) {
    this.queue = [...fixtures];
  }

  async open(cb: SttCallbacks): Promise<SttSession> {
    this.openCount += 1;
    const fixture = this.queue.shift();
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let closed = false;

    if (fixture) {
      let at = 0;
      for (const step of fixture.steps) {
        at += step.delayMs;
        timers.push(
          setTimeout(() => {
            if (closed) return;
            cb.onPartial(step.partial, step.final === true);
            if (step.final) cb.onEndpoint();
          }, at),
        );
      }
    }

    return {
      sendFrame(): void {
        /* fake consumes nothing */
      },
      close(): void {
        closed = true;
        for (const t of timers) clearTimeout(t);
      },
    };
  }
}
