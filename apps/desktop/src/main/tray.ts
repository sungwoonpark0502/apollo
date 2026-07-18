import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'node:path';
import { STRINGS } from '@apollo/shared';

let tray: Tray | null = null;

export function getTray(): Tray | null {
  return tray;
}

export function createTray(opts: { onOpenSettings?: () => void; onOpenWorkspace?: () => void; onOpenChat?: () => void; onQuickCapture?: () => void } = {}): Tray {
  if (tray) return tray;
  const iconPath = join(__dirname, '../../resources/trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Apollo');
  // Right-click (or menu key) shows the menu; left-click opens the Workspace (E3).
  // PART K: typing lives in the Chat tab; the palette entry is gone.
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: STRINGS.app.tray.open, click: () => opts.onOpenWorkspace?.() },
      { label: STRINGS.app.tray.chat, click: () => opts.onOpenChat?.() },
      { label: STRINGS.app.tray.quickCapture, click: () => opts.onQuickCapture?.() },
      { label: STRINGS.app.tray.settings, click: () => opts.onOpenSettings?.() },
      { type: 'separator' },
      { label: STRINGS.app.tray.quit, click: () => app.quit() },
    ]),
  );
  tray.on('click', () => opts.onOpenWorkspace?.());
  return tray;
}
