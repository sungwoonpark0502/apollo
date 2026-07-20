import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { AUDIO_PORT_CHANNEL, invokeChannels, pushChannels, type ApolloBridge } from '@apollo/shared';

const invokeNames = new Set<string>(Object.keys(invokeChannels));
const pushNames = new Set<string>(Object.keys(pushChannels));

// The one object crossing the bridge (C4). Payload validation happens in main.
const apollo: ApolloBridge = {
  call(channel, payload) {
    if (!invokeNames.has(channel)) return Promise.reject(new Error('unknown channel'));
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, listener) {
    if (!pushNames.has(channel)) throw new Error('unknown channel');
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  /**
   * A MessagePort cannot survive contextBridge: what reaches the preload is a
   * proxy object, and ipcRenderer.postMessage rejects it with "Invalid value
   * for transfer". That threw inside startCapture BEFORE the frame handler was
   * attached, so no audio ever reached the worker.
   *
   * Electron's documented pattern instead: mint the channel here, send port2 to
   * main over IPC, and hand port1 to the page with window.postMessage, which
   * does carry real transferables. The page never constructs the port itself.
   */
  requestAudioPort() {
    const { port1, port2 } = new MessageChannel();
    ipcRenderer.postMessage(AUDIO_PORT_CHANNEL, null, [port2]);
    window.postMessage(AUDIO_PORT_CHANNEL, '*', [port1]);
  },
};

contextBridge.exposeInMainWorld('apollo', apollo);
