import { STRINGS } from '@apollo/shared';
import { type TtsAdapter } from './adapter';
import { createChunker, type Chunker } from './chunker';

/**
 * TTS pipeline (C12.5): chunker → adapter → sequenced tts.audio pushes to the
 * orb. stop() aborts synthesis and tells the player to flush instantly.
 * Degrades silently to text+card with a one-time TTS_DOWN notice.
 */
export interface TtsPipelineDeps {
  adapter: TtsAdapter;
  pushAudio: (payload: { seq: number; mime: 'audio/mp3'; data: ArrayBuffer; last: boolean }) => void;
  pushStop: () => void;
  onFirstChunk: () => void;   // → voiceController.ttsStarted()
  onSentence?: (index: number) => void; // E4 spoken-row sync: sentence index now starting
  onError?: (copy: string) => void;
  onSynthChars?: (chars: number) => void; // H4 usage metering: synthesized character count
  perf?: (name: string, durMs: number) => void;
  log?: (msg: string) => void;
}

export function createTtsPipeline(deps: TtsPipelineDeps) {
  let seq = 0;
  let abort: AbortController | null = null;
  let queue: string[] = [];
  let synthesizing = false;
  let firstChunkSent = false;
  let turnStartedAt = 0;
  let ttsDownNotified = false;
  let active = false;
  let ended = false;
  let lastSent = false;
  let generation = 0; // bumped on stop() so an in-flight drain abandons cleanly
  let spokenIndex = 0; // running sentence index for spoken-row sync (E4)

  function maybeFinish(): void {
    if (ended && !synthesizing && queue.length === 0 && firstChunkSent && !lastSent) {
      lastSent = true;
      deps.pushAudio({ seq: seq++, mime: 'audio/mp3', data: new ArrayBuffer(0), last: true });
    }
  }

  const chunker: Chunker = createChunker((sentence) => {
    queue.push(sentence);
    void drain();
  });

  async function drain(): Promise<void> {
    if (synthesizing) return;
    const gen = generation;
    synthesizing = true;
    try {
      while (queue.length > 0 && gen === generation) {
        const sentence = queue.shift() as string;
        deps.onSynthChars?.(sentence.length); // H4 usage metering
        const sentenceIndex = spokenIndex++;
        abort = new AbortController();
        let announced = false;
        try {
          for await (const chunk of deps.adapter.synthesize(sentence, abort.signal)) {
            if (abort.signal.aborted || gen !== generation) return;
            if (!firstChunkSent) {
              firstChunkSent = true;
              if (turnStartedAt) deps.perf?.('tts_first_audio', Date.now() - turnStartedAt);
              deps.onFirstChunk();
            }
            if (!announced) {
              announced = true;
              deps.onSentence?.(sentenceIndex); // E4: this sentence is now audible
            }
            const data = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
            deps.pushAudio({ seq: seq++, mime: 'audio/mp3', data, last: false });
          }
        } catch (e) {
          deps.log?.(`tts synthesis failed: ${e instanceof Error ? e.message : String(e)}`);
          if (!ttsDownNotified) {
            ttsDownNotified = true;
            deps.onError?.(STRINGS.errors.TTS_DOWN);
          }
          queue = [];
          return;
        }
      }
    } finally {
      synthesizing = false;
      maybeFinish();
    }
  }

  return {
    /** New voice turn: reset chunker state. */
    beginTurn(): void {
      active = true;
      ended = false;
      lastSent = false;
      firstChunkSent = false;
      turnStartedAt = Date.now();
      generation += 1; // abandon any drain still winding down from a prior turn
      synthesizing = false;
      spokenIndex = 0;
      chunker.reset();
      queue = [];
    },
    feedToken(text: string): void {
      if (active) chunker.feed(text);
    },
    endTurn(): void {
      if (!active) return;
      chunker.end();
      active = false;
      ended = true;
      maybeFinish();
    },
    /** Barge-in / cancel: abort synthesis and flush the player immediately. */
    stop(): void {
      active = false;
      ended = false;
      generation += 1; // the running drain sees a stale gen and abandons
      synthesizing = false;
      queue = [];
      chunker.reset();
      abort?.abort();
      deps.pushStop();
    },
    isActive(): boolean {
      return active || synthesizing || queue.length > 0;
    },
  };
}

export type TtsPipeline = ReturnType<typeof createTtsPipeline>;
