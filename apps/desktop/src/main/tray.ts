import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'node:path';
import { togglePalette } from './windows';

let tray: Tray | null = null;

export function getTray(): Tray | null {
  return tray;
}

export function createTray(): Tray {
  if (tray) return tray;
  const iconPath = join(__dirname, '../../resources/trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Apollo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Apollo', click: () => togglePalette() },
      { type: 'separator' },
      { label: 'Quit Apollo', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => togglePalette());
  return tray;
}
