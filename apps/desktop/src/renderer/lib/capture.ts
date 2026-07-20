import { AUDIO_PORT_CHANNEL } from '@apollo/shared';

/**
 * C12.1 capture: getUserMedia with OS echo cancellation + AudioWorklet framer.
 * Frames flow renderer → audio worker over a dedicated MessagePort (C4).
 */
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;

export async function startCapture(): Promise<void> {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 16000,
    },
  });
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/audio-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const framer = new AudioWorkletNode(ctx, 'apollo-framer');
  source.connect(framer);

  // The preload mints the channel and delivers our end as a window message,
  // because a MessagePort cannot cross contextBridge (see preload/index.ts).
  const port = await audioPort();
  framer.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    port.postMessage(e.data, [e.data]);
  };
}

/** Resolves with the renderer's end of the audio channel. */
function audioPort(): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      // Fail loudly: silently returning would leave a live mic capturing into
      // nothing, which is exactly how the original bug stayed invisible.
      reject(new Error('audio port was never delivered by the preload'));
    }, 5000);
    function onMessage(e: MessageEvent): void {
      if (e.source !== window || e.data !== AUDIO_PORT_CHANNEL) return;
      const p = e.ports[0];
      if (!p) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(p);
    }
    window.addEventListener('message', onMessage);
    window.apollo.requestAudioPort();
  });
}

export async function stopCapture(): Promise<void> {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  await ctx?.close();
  ctx = null;
}

export async function ensureCapture(): Promise<void> {
  if (!ctx) await startCapture();
}
