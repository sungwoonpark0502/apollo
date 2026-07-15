import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { type TtsAdapter } from './adapter';

/**
 * Default TTS adapter (C12.5): msedge-tts, voice from settings
 * (default en-US-JennyNeural), mp3 output streamed per sentence.
 */
export function createEdgeTts(deps: { voice: () => string; rate?: () => number; log?: (m: string) => void }): TtsAdapter {
  return {
    async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<Buffer> {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(deps.voice(), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      // H7 TTS rate: msedge-tts expects a percentage delta (e.g. 1.1 → "+10%").
      const rate = deps.rate?.() ?? 1;
      const ratePct = `${rate >= 1 ? '+' : '-'}${Math.round(Math.abs(rate - 1) * 100)}%`;
      const { audioStream } = tts.toStream(text, { rate: ratePct });
      try {
        for await (const chunk of audioStream) {
          if (signal?.aborted) return;
          yield chunk as Buffer;
        }
      } finally {
        tts.close();
      }
    },
  };
}
