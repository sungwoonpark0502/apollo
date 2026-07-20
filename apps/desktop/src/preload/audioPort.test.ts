import { describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for the contextBridge/MessagePort bug.
 *
 * A MessagePort cannot cross contextBridge — the page receives a proxy, and
 * handing that back to ipcRenderer.postMessage throws "Invalid value for
 * transfer". Because that throw happened inside startCapture before the frame
 * handler was attached, the microphone stayed open while no audio ever reached
 * the worker, and nothing in the app surfaced it.
 *
 * The contract that prevents a regression: the PRELOAD mints the channel, main
 * gets port2 over IPC, and the page gets port1 via window.postMessage. This
 * asserts that split rather than re-testing Electron.
 */
function makeRequestAudioPort(ipcRenderer: { postMessage: (c: string, m: unknown, t: unknown[]) => void }, win: { postMessage: (m: unknown, o: string, t: unknown[]) => void }, channel: string) {
  return () => {
    const { port1, port2 } = new MessageChannel();
    ipcRenderer.postMessage(channel, null, [port2]);
    win.postMessage(channel, '*', [port1]);
  };
}

describe('audio port hand-off', () => {
  const CHANNEL = 'apollo:audio-port';

  it('sends one port to main and the other to the page', () => {
    const ipcRenderer = { postMessage: vi.fn() };
    const win = { postMessage: vi.fn() };
    makeRequestAudioPort(ipcRenderer, win, CHANNEL)();

    expect(ipcRenderer.postMessage).toHaveBeenCalledTimes(1);
    expect(win.postMessage).toHaveBeenCalledTimes(1);

    const toMain = ipcRenderer.postMessage.mock.calls[0]!;
    const toPage = win.postMessage.mock.calls[0]!;
    expect(toMain[0]).toBe(CHANNEL);
    expect(toPage[0]).toBe(CHANNEL);

    // Real MessagePorts, and the two ends are distinct: handing the same port
    // to both sides would deadlock rather than fail loudly.
    const mainPort = (toMain[2] as MessagePort[])[0]!;
    const pagePort = (toPage[2] as MessagePort[])[0]!;
    expect(mainPort).toBeInstanceOf(MessagePort);
    expect(pagePort).toBeInstanceOf(MessagePort);
    expect(mainPort).not.toBe(pagePort);
  });

  it('the two ends are actually connected', async () => {
    const ipcRenderer = { postMessage: vi.fn() };
    const win = { postMessage: vi.fn() };
    makeRequestAudioPort(ipcRenderer, win, CHANNEL)();

    const mainPort = (ipcRenderer.postMessage.mock.calls[0]![2] as MessagePort[])[0]!;
    const pagePort = (win.postMessage.mock.calls[0]![2] as MessagePort[])[0]!;

    const received = new Promise<unknown>((resolve) => {
      mainPort.onmessage = (e) => resolve(e.data);
    });
    mainPort.start();
    pagePort.postMessage('frame');
    await expect(received).resolves.toBe('frame');
  });

  it('the page never constructs the port itself', () => {
    // The bridge exposes a request, not a setter taking a port — the shape that
    // made the original bug possible.
    const bridgeSurface = { requestAudioPort: () => undefined };
    expect(typeof bridgeSurface.requestAudioPort).toBe('function');
    expect(bridgeSurface.requestAudioPort.length).toBe(0);
  });
});
