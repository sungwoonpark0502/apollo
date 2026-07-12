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

  // Hand one side of a channel to main, which forwards it to the audio worker.
  const channel = new MessageChannel();
  window.apollo.sendAudioPort(channel.port2);
  framer.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    channel.port1.postMessage(e.data, [e.data]);
  };
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
