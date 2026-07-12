import { createClient, LiveTranscriptionEvents, type ListenLiveClient } from '@deepgram/sdk';
import { AppError } from '@apollo/shared';
import { type SttAdapter, type SttCallbacks, type SttSession } from './stt';

/**
 * Deepgram listen.live (C12.4): nova-3, linear16/16k, interim results,
 * endpointing 500, keyterm Apollo. KeepAlive every 8s. One reconnect
 * preserving buffered frames; a second failure degrades to STT_DOWN.
 */
export interface DeepgramDeps {
  apiKey: () => string | null;
  log?: (msg: string) => void;
}

const LIVE_OPTIONS = {
  model: 'nova-3',
  language: 'en-US',
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  interim_results: true,
  smart_format: true,
  endpointing: 500,
  vad_events: true,
  keyterm: 'Apollo',
} as const;

export function createDeepgramStt(deps: DeepgramDeps): SttAdapter {
  return {
    async open(cb: SttCallbacks): Promise<SttSession> {
      const key = deps.apiKey();
      if (!key) throw new AppError('KEY_MISSING', 'no deepgram key');
      const client = createClient(key);

      let live: ListenLiveClient | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let closedByUs = false;
      let reconnected = false;
      const buffer: ArrayBuffer[] = [];
      let ready = false;

      function connect(): void {
        live = client.listen.live({ ...LIVE_OPTIONS });
        live.on(LiveTranscriptionEvents.Open, () => {
          ready = true;
          for (const f of buffer.splice(0)) live?.send(f);
        });
        live.on(LiveTranscriptionEvents.Transcript, (data: { channel?: { alternatives?: Array<{ transcript?: string }> }; is_final?: boolean; speech_final?: boolean }) => {
          const text = data.channel?.alternatives?.[0]?.transcript ?? '';
          if (text) cb.onPartial(text, data.is_final === true);
          if (data.speech_final) cb.onEndpoint();
        });
        live.on(LiveTranscriptionEvents.UtteranceEnd, () => cb.onEndpoint());
        live.on(LiveTranscriptionEvents.Error, (e: unknown) => {
          deps.log?.(`deepgram error: ${JSON.stringify(e).slice(0, 200)}`);
        });
        live.on(LiveTranscriptionEvents.Close, () => {
          ready = false;
          if (closedByUs) return;
          if (!reconnected) {
            reconnected = true; // one reconnect preserving buffered frames
            deps.log?.('deepgram closed unexpectedly; reconnecting once');
            connect();
          } else {
            cb.onError('STT_DOWN');
          }
        });
        keepAlive ??= setInterval(() => {
          try {
            live?.keepAlive();
          } catch {
            /* socket gone; Close handler deals with it */
          }
        }, 8_000);
      }

      connect();

      return {
        sendFrame(pcm: ArrayBuffer): void {
          if (ready && live) live.send(pcm);
          else buffer.push(pcm);
        },
        close(): void {
          closedByUs = true;
          if (keepAlive) clearInterval(keepAlive);
          try {
            live?.requestClose();
          } catch {
            /* already closed */
          }
        },
      };
    },
  };
}
