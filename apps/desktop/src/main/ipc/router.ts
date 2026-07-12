import {
  invokeChannels,
  pushChannels,
  DEV_ONLY_CHANNELS,
  type InvokeChannelName,
  type InvokeReq,
  type InvokeRes,
  type PushChannelName,
  type PushPayload,
} from '@apollo/shared';
// Electron types only; runtime objects are injected so this module stays unit-testable.
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

export type Handlers = {
  [K in InvokeChannelName]: (req: InvokeReq<K>, sender: WebContents | undefined) => Promise<InvokeRes<K>> | InvokeRes<K>;
};

export interface RouterOpts {
  isTrustedUrl: (url: string) => boolean;
  isDev: boolean;
  log: (msg: string) => void;
}

export class IpcRejectedError extends Error {
  constructor(public readonly reason: 'untrusted_sender' | 'invalid_payload', detail?: string) {
    super(`ipc rejected: ${reason}${detail ? ` ${detail}` : ''}`);
    this.name = 'IpcRejectedError';
  }
}

/** Pure per-channel pipeline: frame check → zod req parse → handler → zod res parse. */
export function makeChannelHandler<K extends InvokeChannelName>(
  name: K,
  handler: Handlers[K],
  opts: RouterOpts,
): (frameUrl: string | undefined, payload: unknown, sender?: WebContents) => Promise<InvokeRes<K>> {
  const def = invokeChannels[name];
  return async (frameUrl, payload, sender) => {
    if (!frameUrl || !opts.isTrustedUrl(frameUrl)) {
      opts.log(`ipc dropped (untrusted sender) channel=${name}`);
      throw new IpcRejectedError('untrusted_sender');
    }
    const parsed = def.req.safeParse(payload);
    if (!parsed.success) {
      opts.log(`ipc rejected (invalid payload) channel=${name} issues=${parsed.error.issues.length}`);
      throw new IpcRejectedError('invalid_payload', parsed.error.issues[0]?.message);
    }
    const result = await handler(parsed.data as InvokeReq<K>, sender);
    return def.res.parse(result) as InvokeRes<K>;
  };
}

/** Registers every channel from the shared table; unknown channels are never registered, so they are dropped. */
export function registerRouter(ipcMain: IpcMain, handlers: Handlers, opts: RouterOpts): void {
  for (const name of Object.keys(invokeChannels) as InvokeChannelName[]) {
    if (!opts.isDev && DEV_ONLY_CHANNELS.includes(name)) continue;
    const pipeline = makeChannelHandler(name, handlers[name], opts);
    ipcMain.handle(name, (event: IpcMainInvokeEvent, payload: unknown) =>
      pipeline(event.senderFrame?.url, payload, event.sender),
    );
  }
}

/** Validated Main → Renderer push. */
export function pushTo<K extends PushChannelName>(wc: WebContents, channel: K, payload: PushPayload<K>): void {
  pushChannels[channel].parse(payload);
  wc.send(channel, payload);
}

/** A frame is ours if it is the dev server during dev, or a packaged file:// URL. */
export function makeTrustedUrlCheck(devServerUrl: string | undefined): (url: string) => boolean {
  return (url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return true;
    return url.startsWith('file://');
  };
}
