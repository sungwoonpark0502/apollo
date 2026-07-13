import { BrowserWindow, screen, shell } from 'electron';
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

const ORB_WIDTH = 420; // orb + panel
const ORB_HEIGHT = 640;

let orb: BrowserWindow | null = null;

export function getOrbWindow(): BrowserWindow | null {
  return orb;
}

/** C18 orb window: docked to the right edge, 30% from top, never focusable. */
export function createOrbWindow(): BrowserWindow {
  if (orb && !orb.isDestroyed()) return orb;
  const display = screen.getPrimaryDisplay();
  const { width, height, y: workY } = display.workArea;
  orb = new BrowserWindow({
    width: ORB_WIDTH,
    height: ORB_HEIGHT,
    x: display.workArea.x + width - ORB_WIDTH,
    y: workY + Math.round(height * 0.3),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(orb);
  orb.setAlwaysOnTop(true, 'screen-saver');
  orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  orb.on('closed', () => {
    orb = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void orb.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/orb/index.html`);
  } else {
    void orb.loadFile(join(__dirname, '../renderer/windows/orb/index.html'));
  }
  orb.showInactive(); // visible without stealing focus
  return orb;
}

let audioWin: BrowserWindow | null = null;

/** Hidden capture renderer (C12.1). Never shown; exists only to run getUserMedia + AudioWorklet. */
export function createAudioWindow(): BrowserWindow {
  if (audioWin && !audioWin.isDestroyed()) return audioWin;
  audioWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(audioWin);
  audioWin.on('closed', () => {
    audioWin = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void audioWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/audio/index.html`);
  } else {
    void audioWin.loadFile(join(__dirname, '../renderer/windows/audio/index.html'));
  }
  return audioWin;
}

let onboardingWin: BrowserWindow | null = null;

export function createOnboardingWindow(): BrowserWindow {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.show();
    return onboardingWin;
  }
  onboardingWin = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    fullscreenable: false,
    title: 'Welcome to Apollo',
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(onboardingWin);
  onboardingWin.on('closed', () => {
    onboardingWin = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void onboardingWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/onboarding/index.html`);
  } else {
    void onboardingWin.loadFile(join(__dirname, '../renderer/windows/onboarding/index.html'));
  }
  return onboardingWin;
}

export function closeOnboardingWindow(): void {
  onboardingWin?.close();
  onboardingWin = null;
}

let settingsWin: BrowserWindow | null = null;

export function openSettingsWindow(): BrowserWindow {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    fullscreenable: false,
    title: 'Apollo Settings',
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(settingsWin);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void settingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/settings/index.html`);
  } else {
    void settingsWin.loadFile(join(__dirname, '../renderer/windows/settings/index.html'));
  }
  return settingsWin;
}
