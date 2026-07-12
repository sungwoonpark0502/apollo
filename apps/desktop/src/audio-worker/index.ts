import { AUDIO, mainToWorkerSchema, type WorkerToMain } from '@apollo/shared';
import { createWorkerCore, type WorkerCore } from './core';
import { FakeWake } from './wake/fake';
import { createPorcupineWake } from './wake/porcupine';
import { SileroVad, createSileroProbFn } from './vad/silero';

/**
 * utilityProcess entry. Env:
 *  APOLLO_VAD_MODEL  – path to silero_vad.onnx
 *  APOLLO_WAKE       – 'porcupine' | 'fake'
 *  APOLLO_PICOVOICE_KEY / APOLLO_WAKE_KEYWORD_PATH – porcupine config
 */
// Listeners on parentPort do not hold the Node event loop open; this does.
setInterval(() => undefined, 1 << 30);

async function main(): Promise<void> {
  const send = (msg: WorkerToMain, transfer?: ArrayBuffer[]): void => {
    // @ts-expect-error utilityProcess parentPort exists in this context
    process.parentPort.postMessage(msg, transfer);
  };

  let core: WorkerCore;
  try {
    const probFn = await createSileroProbFn(process.env['APOLLO_VAD_MODEL'] as string);
    const wake =
      process.env['APOLLO_WAKE'] === 'porcupine'
        ? await createPorcupineWake({
            accessKey: process.env['APOLLO_PICOVOICE_KEY'] as string,
            keywordPath: process.env['APOLLO_WAKE_KEYWORD_PATH'],
            sensitivity: Number(process.env['APOLLO_WAKE_SENSITIVITY'] ?? 0.5),
          })
        : new FakeWake();
    core = createWorkerCore({ wake, vad: new SileroVad(probFn), send });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`audio worker init failed: ${msg}`);
    send({ t: 'fatal', msg });
    return;
  }

  process.parentPort.on('message', (e: { data: unknown; ports: Electron.MessagePortMain[] }) => {
    const port = e.ports?.[0];
    if (port) {
      // Dedicated audio frame port from the capture renderer (C4).
      port.on('message', (pm: { data: unknown }) => {
        const buf = pm.data;
        if (buf instanceof ArrayBuffer && buf.byteLength === AUDIO.frameSamples * 2) {
          void core.frame(new Int16Array(buf));
        }
      });
      port.start();
      return;
    }
    const parsed = mainToWorkerSchema.safeParse(e.data);
    if (parsed.success) core.control(parsed.data);
  });
  console.log('audio worker ready');
}

void main();
