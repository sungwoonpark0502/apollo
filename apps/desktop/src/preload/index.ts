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
  sendAudioPort(port) {
    ipcRenderer.postMessage(AUDIO_PORT_CHANNEL, null, [port]);
  },
};

contextBridge.exposeInMainWorld('apollo', apollo);
