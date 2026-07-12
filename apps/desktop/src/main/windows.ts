import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

const PALETTE_WIDTH = 640;
const PALETTE_HEIGHT = 420;

export function hardenWindow(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in the system browser only; no child windows ever.
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

export function secureWebPreferences(): Electron.WebPreferences {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    preload: join(__dirname, '../preload/index.js'),
  };
}

let palette: BrowserWindow | null = null;

export function getPaletteWindow(): BrowserWindow | null {
  return palette;
}

export function createPaletteWindow(): BrowserWindow {
  if (palette && !palette.isDestroyed()) return palette;
  palette = new BrowserWindow({
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, transparent: true }
      : { backgroundMaterial: 'acrylic' as const }),
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(palette);
  palette.on('blur', () => palette?.hide());
  palette.on('closed', () => {
    palette = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void palette.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/palette/index.html`);
  } else {
    void palette.loadFile(join(__dirname, '../renderer/windows/palette/index.html'));
  }
  return palette;
}

export function togglePalette(): void {
  const win = createPaletteWindow();
  if (win.isVisible()) {
    win.hide();
  } else {
    win.center();
    win.show();
    win.focus();
  }
}
