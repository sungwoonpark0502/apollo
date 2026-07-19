import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

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

// PART K: the palette window is gone. Typing lives in the Workspace Chat tab;
// the two remaining surfaces are the orb (voice) and the Workspace.

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
  // L3.1: the orb starts hidden. orbController shows it (showInactive, so it
  // never steals focus) on wake/PTT/nudge and hides it again when idle.
  return orb;
}

let audioWin: BrowserWindow | null = null;

/** Dedicated session partition for the audio capture window (H3): only this
 *  session is granted media permission. */
export const AUDIO_SESSION_PARTITION = 'apollo-audio';

/** Hidden capture renderer (C12.1). Never shown; exists only to run getUserMedia + AudioWorklet. */
export function createAudioWindow(): BrowserWindow {
  if (audioWin && !audioWin.isDestroyed()) return audioWin;
  audioWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: { ...secureWebPreferences(), partition: AUDIO_SESSION_PARTITION },
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

let workspaceWin: BrowserWindow | null = null;

export function getWorkspaceWindow(): BrowserWindow | null {
  return workspaceWin;
}

export interface WorkspaceWindowDeps {
  getBounds: () => { x?: number; y?: number; width: number; height: number } | null;
  saveBounds: (b: { x: number; y: number; width: number; height: number }) => void;
}

/** E3 Workspace window: default 1080x720, min 860x600, bounds persisted, single instance. */
export function openWorkspaceWindow(deps: WorkspaceWindowDeps): BrowserWindow {
  if (workspaceWin && !workspaceWin.isDestroyed()) {
    if (workspaceWin.isMinimized()) workspaceWin.restore();
    workspaceWin.show();
    workspaceWin.focus();
    return workspaceWin;
  }
  const saved = deps.getBounds();
  workspaceWin = new BrowserWindow({
    width: saved?.width ?? 1080,
    height: saved?.height ?? 720,
    ...(saved?.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Apollo',
    webPreferences: secureWebPreferences(),
  });
  hardenWindow(workspaceWin);
  const persist = (): void => {
    if (workspaceWin && !workspaceWin.isDestroyed()) deps.saveBounds(workspaceWin.getBounds());
  };
  workspaceWin.on('moved', persist);
  workspaceWin.on('resized', persist);
  workspaceWin.on('close', persist);
  workspaceWin.on('closed', () => {
    workspaceWin = null;
  });
  workspaceWin.once('ready-to-show', () => workspaceWin?.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    void workspaceWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/workspace/index.html`);
  } else {
    void workspaceWin.loadFile(join(__dirname, '../renderer/windows/workspace/index.html'));
  }
  return workspaceWin;
}

let captureWin: BrowserWindow | null = null;

/** F4 Quick Capture: frameless 520x64, centered at 22% viewport height, Esc/blur closes. */
export function openCaptureWindow(): BrowserWindow {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.show();
    captureWin.focus();
    return captureWin;
  }
  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.workArea;
  const W = 520;
  const H = 64;
  captureWin = new BrowserWindow({
    width: W,
    height: H,
    x: x + Math.round((width - W) / 2),
    y: y + Math.round(height * 0.22),
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
  hardenWindow(captureWin);
  captureWin.on('blur', () => captureWin?.hide());
  captureWin.on('closed', () => {
    captureWin = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void captureWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/capture/index.html`);
  } else {
    void captureWin.loadFile(join(__dirname, '../renderer/windows/capture/index.html'));
  }
  captureWin.once('ready-to-show', () => {
    captureWin?.show();
    captureWin?.focus();
  });
  return captureWin;
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWin;
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
