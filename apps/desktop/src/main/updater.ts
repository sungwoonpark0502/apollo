import { STRINGS } from '@apollo/shared';

/**
 * C14.8 / C22: electron-updater over HTTPS with signature verification. The
 * feed URL comes from electron-builder.yml publish config. Loaded lazily so
 * unit tests and dev never pull the updater.
 */
export interface UpdaterDeps {
  isPackaged: boolean;
  notify: (title: string, body: string) => void;
  log: (msg: string) => void;
}

export async function initUpdater(deps: UpdaterDeps): Promise<void> {
  if (!deps.isPackaged) return; // updates only in packaged builds
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', () => {
      deps.notify(STRINGS.app.name, STRINGS.notifications.updateReady);
    });
    autoUpdater.on('error', (e: Error) => deps.log(`updater error: ${e.message}`));
    await autoUpdater.checkForUpdates();
    // Re-check every 6 hours.
    setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 6 * 60 * 60 * 1000);
  } catch (e) {
    deps.log(`updater unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
}
