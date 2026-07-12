import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'node:path';
import { STRINGS } from '@apollo/shared';
import { togglePalette } from './windows';

let tray: Tray | null = null;

export function getTray(): Tray | null {
  return tray;
}

export function createTray(opts: { onOpenSettings?: () => void } = {}): Tray {
  if (tray) return tray;
  const iconPath = join(__dirname, '../../resources/trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Apollo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: STRINGS.app.tray.open, click: () => togglePalette() },
      { label: STRINGS.app.tray.settings, click: () => opts.onOpenSettings?.() },
      { type: 'separator' },
      { label: STRINGS.app.tray.quit, click: () => app.quit() },
    ]),
  );
  tray.on('click', () => togglePalette());
  return tray;
}
