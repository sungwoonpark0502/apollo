import { createClient, LiveTranscriptionEvents, type ListenLiveClient } from '@deepgram/sdk';
import { type HttpsProxyAgent } from 'https-proxy-agent';
import { AppError } from '@apollo/shared';
import { type SttAdapter, type SttCallbacks, type SttSession } from './stt';
import { agentForResolvedProxy } from '../net/proxy';

/**
 * Deepgram listen.live (C12.4): nova-3, linear16/16k, interim results,
 * endpointing 500, keyterm Apollo. KeepAlive every 8s. One reconnect
 * preserving buffered frames; a second failure degrades to STT_DOWN.
 */
export interface DeepgramDeps {
  /**
   * The credential to open the live session with. BYOK returns the user's key
   * synchronously; managed mode returns a promise that mints a short-lived
   * scoped token from the Apollo backend (L0.1) — the server key never reaches
   * the device either way.
   */
  apiKey: () => string | null | Promise<string | null>;
  /** H4: resolves the system proxy for the Deepgram WS URL (session.resolveProxy). */
  resolveProxy?: (url: string) => Promise<string>;
  log?: (msg: string) => void;
}

const DEEPGRAM_WS_URL = 'https://api.deepgram.com/v1/listen';

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
      const key = await deps.apiKey();
      if (!key) throw new AppError('KEY_MISSING', 'no deepgram key');
      // H4: route the WS through the system proxy when one is configured.
      let agent: HttpsProxyAgent<string> | null = null;
      if (deps.resolveProxy) {
        try {
          agent = agentForResolvedProxy(await deps.resolveProxy(DEEPGRAM_WS_URL));
          if (agent) deps.log?.('deepgram: connecting via system proxy');
        } catch {
          /* proxy resolution best-effort; fall back to direct */
        }
      }
      // The SDK's option typing does not surface the ws agent field; cast narrowly.
      const client = createClient(key, agent ? ({ global: { websocket: { options: { agent } } } } as unknown as Parameters<typeof createClient>[1]) : undefined);

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
