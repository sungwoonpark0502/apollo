import { app, BrowserWindow } from 'electron';
import { createTray, getTray } from './tray';
import { createPaletteWindow, togglePalette } from './windows';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => togglePalette());

  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();
    createTray();
    const palette = createPaletteWindow();

    if (process.env['APOLLO_SMOKE'] === '1') {
      palette.webContents.once('did-finish-load', () => {
        // eslint-disable-next-line no-console
        console.log(`SMOKE_OK tray=${getTray() !== null} palette=${!palette.isDestroyed()}`);
        app.exit(0);
      });
    }
  });

  // Tray app: closing all windows must not quit.
  app.on('window-all-closed', () => {
    /* keep running in tray */
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPaletteWindow();
  });
}
