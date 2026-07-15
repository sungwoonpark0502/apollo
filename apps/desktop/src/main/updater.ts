import { STRINGS } from '@apollo/shared';

/**
 * C14.8 / C22: electron-updater over HTTPS with signature verification. The
 * feed URL comes from electron-builder.yml publish config. Loaded lazily so
 * unit tests and dev never pull the updater.
 */
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready';

export interface UpdaterDeps {
  isPackaged: boolean;
  notify: (title: string, body: string) => void;
  onState: (status: UpdateStatus, version?: string) => void; // H7 update.state push
  log: (msg: string) => void;
}

export interface UpdaterHandle {
  install: () => void; // H7 update.install (quit + install; only valid when ready)
  state: () => { status: UpdateStatus; version?: string };
}

export async function initUpdater(deps: UpdaterDeps): Promise<UpdaterHandle> {
  let status: UpdateStatus = 'idle';
  let version: string | undefined;
  let quitAndInstall: (() => void) | null = null;
  const set = (s: UpdateStatus, v?: string): void => { status = s; version = v ?? version; deps.onState(status, version); };

  if (!deps.isPackaged) return { install: () => undefined, state: () => ({ status, version }) };
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false; // never auto-restart (H7)
    quitAndInstall = () => autoUpdater.quitAndInstall();
    autoUpdater.on('checking-for-update', () => set('checking'));
    autoUpdater.on('update-available', (info: { version?: string }) => set('downloading', info.version));
    autoUpdater.on('update-not-available', () => set('idle'));
    autoUpdater.on('update-downloaded', (info: { version?: string }) => {
      set('ready', info.version);
      deps.notify(STRINGS.app.name, STRINGS.notifications.updateReady);
    });
    autoUpdater.on('error', (e: Error) => deps.log(`updater error: ${e.message}`));
    await autoUpdater.checkForUpdates();
    setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 6 * 60 * 60 * 1000);
  } catch (e) {
    deps.log(`updater unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    install: () => { if (status === 'ready' && quitAndInstall) quitAndInstall(); },
    state: () => ({ status, version }),
  };
}
