import { z } from 'zod';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { STRINGS, type ToolDef } from '@apollo/shared';

/**
 * C7/C14: system tools. All OS commands are fixed templates executed via
 * spawn with array args and shell:false — never a shell string, never exec.
 * Launch goes through shell.openPath against a boot-time allowlist only.
 */
export interface SpawnRunner {
  (cmd: string, args: string[]): Promise<{ code: number; stdout: string }>;
}

export interface SystemToolDeps {
  platform?: NodeJS.Platform;
  run: SpawnRunner;
  openPath: (path: string) => Promise<string>; // electron shell.openPath; '' on success
  listAppDirs?: () => string[];                // test hook
  picturesDir?: () => string;
  now?: () => number;
}

export interface AppEntry {
  name: string;
  path: string;
}

/** Boot-time allowlist scan (C7 system.openApp). macOS: /Applications + ~/Applications. */
export function scanApps(platform: NodeJS.Platform, dirs?: string[]): AppEntry[] {
  const apps: AppEntry[] = [];
  if (platform === 'darwin') {
    const roots = dirs ?? ['/Applications', '/System/Applications', join(homedir(), 'Applications')];
    for (const root of roots) {
      let entries: string[];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.endsWith('.app')) apps.push({ name: basename(e, '.app'), path: join(root, e) });
      }
    }
  } else if (platform === 'win32') {
    // Start Menu shortcuts; App Paths registry additions are a HUMAN_TODO manual verification (B3)
    const roots = dirs ?? [
      join(process.env['ProgramData'] ?? 'C:/ProgramData', 'Microsoft/Windows/Start Menu/Programs'),
      join(process.env['APPDATA'] ?? '', 'Microsoft/Windows/Start Menu/Programs'),
    ];
    for (const root of roots) {
      let entries: string[];
      try {
        entries = readdirSync(root, { recursive: true }) as string[];
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.endsWith('.lnk')) apps.push({ name: basename(e, '.lnk'), path: join(root, e) });
      }
    }
  }
  return apps;
}

/** Fuzzy rank: exact > prefix > substring > token subsequence. */
export function rankApps(apps: AppEntry[], query: string): AppEntry[] {
  const q = query.trim().toLowerCase();
  return apps
    .map((a) => {
      const n = a.name.toLowerCase();
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;
      else {
        const tokens = q.split(/\s+/);
        if (tokens.every((t) => n.includes(t))) score = 40;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.length - y.a.name.length)
    .map((x) => x.a);
}

export function createSystemTools(deps: SystemToolDeps): ToolDef[] {
  const platform = deps.platform ?? process.platform;
  let allowlist: AppEntry[] | null = null;
  const apps = (): AppEntry[] => {
    allowlist ??= scanApps(platform, deps.listAppDirs?.());
    return allowlist;
  };

  const openApp: ToolDef<z.ZodType<{ name: string }>> = {
    name: 'system.openApp',
    tier: 2,
    description: 'Open an installed application by (fuzzy) name. Only apps found in the system applications folders can be opened.',
    params: z.object({ name: z.string().min(1) }),
    async execute(a) {
      const ranked = rankApps(apps(), a.name);
      const hit = ranked[0];
      if (!hit) {
        const closest = apps()
          .slice()
          .sort((x, y) => x.name.localeCompare(y.name))
          .slice(0, 3)
          .map((x) => x.name);
        return { llmText: `WARNING no app matched "${a.name}". ${STRINGS.spoken.appNotFound(ranked.slice(0, 3).map((r) => r.name).concat(closest).slice(0, 3))}` };
      }
      const err = await deps.openPath(hit.path);
      if (err) return { llmText: `ERROR could not open ${hit.name}: ${err}` };
      return { llmText: `Opening ${hit.name}.` };
    },
  };

  const volumeParams = z.object({
    op: z.enum(['set', 'up', 'down']),
    value: z.number().int().min(0).max(100).optional(),
  });
  const volume: ToolDef<typeof volumeParams> = {
    name: 'system.volume',
    tier: 2,
    description: 'System output volume: op "set" with value 0..100, or "up"/"down" (10-point steps).',
    params: volumeParams,
    async execute(a) {
      if (a.op === 'set' && a.value === undefined) return { llmText: 'ERROR set needs a value 0..100' };
      if (platform === 'darwin') {
        let target: number;
        if (a.op === 'set') {
          target = a.value as number;
        } else {
          const cur = await deps.run('osascript', ['-e', 'output volume of (get volume settings)']);
          const current = parseInt(cur.stdout.trim(), 10);
          if (Number.isNaN(current)) return { llmText: 'ERROR could not read current volume' };
          target = Math.max(0, Math.min(100, current + (a.op === 'up' ? 10 : -10)));
        }
        const n = Math.round(target); // integer-validated by zod + rounding; template arg only
        const res = await deps.run('osascript', ['-e', `set volume output volume ${n}`]);
        if (res.code !== 0) return { llmText: 'ERROR volume command failed' };
        return { llmText: STRINGS.spoken.volumeSet(n) };
      }
      if (platform === 'win32') {
        // Fixed PowerShell template, validated args, shell:false (C7)
        const steps = a.op === 'set' ? null : a.op === 'up' ? 5 : 5; // 5 keypresses ≈ 10 points
        const script =
          a.op === 'set'
            ? `$obj = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $obj.SendKeys([char]174) }; 1..${Math.round((a.value as number) / 2)} | ForEach-Object { $obj.SendKeys([char]175) }`
            : `$obj = New-Object -ComObject WScript.Shell; 1..${steps} | ForEach-Object { $obj.SendKeys([char]${a.op === 'up' ? 175 : 174}) }`;
        const res = await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
        if (res.code !== 0) return { llmText: 'ERROR volume command failed' };
        return { llmText: a.op === 'set' ? STRINGS.spoken.volumeSet(a.value as number) : `Volume ${a.op}.` };
      }
      return { llmText: 'ERROR volume control not supported on this platform' };
    },
  };

  const mediaParams = z.object({ op: z.enum(['playpause', 'next', 'prev']) });
  const media: ToolDef<typeof mediaParams> = {
    name: 'system.media',
    tier: 2,
    description: 'Media playback control: playpause, next, prev.',
    params: mediaParams,
    async execute(a) {
      if (platform === 'darwin') {
        // Controls the running player (Spotify preferred, else Music) without launching one.
        const script = `
          on isRunning(appName)
            tell application "System Events" to (name of processes) contains appName
          end isRunning
          set cmd to "${a.op}"
          if isRunning("Spotify") then
            tell application "Spotify"
              if cmd is "playpause" then
                playpause
              else if cmd is "next" then
                next track
              else
                previous track
              end if
            end tell
          else if isRunning("Music") then
            tell application "Music"
              if cmd is "playpause" then
                playpause
              else if cmd is "next" then
                next track
              else
                previous track
              end if
            end tell
          else
            return "no-player"
          end if`;
        const res = await deps.run('osascript', ['-e', script]);
        if (res.stdout.includes('no-player')) return { llmText: 'WARNING no media player is running.' };
        if (res.code !== 0) return { llmText: 'ERROR media control failed' };
        return { llmText: `Media ${a.op}.` };
      }
      if (platform === 'win32') {
        const key = a.op === 'playpause' ? 179 : a.op === 'next' ? 176 : 177;
        const res = await deps.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$obj = New-Object -ComObject WScript.Shell; $obj.SendKeys([char]${key})`,
        ]);
        if (res.code !== 0) return { llmText: 'ERROR media control failed' };
        return { llmText: `Media ${a.op}.` };
      }
      return { llmText: 'ERROR media control not supported on this platform' };
    },
  };

  const screenshot: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'system.screenshot',
    tier: 2,
    description: 'Capture the full screen to Pictures/Apollo.',
    params: z.object({}),
    async execute() {
      const dir = deps.picturesDir ? deps.picturesDir() : join(homedir(), 'Pictures');
      const path = join(dir, 'Apollo', `apollo-${deps.now ? deps.now() : Date.now()}.png`);
      if (platform === 'darwin') {
        await deps.run('mkdir', ['-p', join(dir, 'Apollo')]);
        const res = await deps.run('screencapture', ['-x', path]);
        if (res.code !== 0) return { llmText: 'ERROR screenshot failed (check Screen Recording permission)' };
        return { llmText: `Screenshot saved to ${path}.` };
      }
      if (platform === 'win32') {
        const res = await deps.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); New-Item -ItemType Directory -Force -Path (Split-Path '${path}') | Out-Null; $bmp.Save('${path}')`,
        ]);
        if (res.code !== 0) return { llmText: 'ERROR screenshot failed' };
        return { llmText: `Screenshot saved to ${path}.` };
      }
      return { llmText: 'ERROR screenshots not supported on this platform' };
    },
  };

  const lock: ToolDef<z.ZodType<Record<string, never>>> = {
    name: 'system.lock',
    tier: 2,
    description: 'Lock the session immediately.',
    params: z.object({}),
    async execute() {
      if (platform === 'darwin') {
        const res = await deps.run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession', ['-suspend']);
        if (res.code !== 0) return { llmText: 'ERROR lock failed' };
        return { llmText: 'Locked.' };
      }
      if (platform === 'win32') {
        const res = await deps.run('rundll32.exe', ['user32.dll,LockWorkStation']);
        if (res.code !== 0) return { llmText: 'ERROR lock failed' };
        return { llmText: 'Locked.' };
      }
      return { llmText: 'ERROR lock not supported on this platform' };
    },
  };

  return [openApp, volume, media, screenshot, lock];
}

/** Production runner: spawn with array args, shell:false (C14.4). */
export function spawnRunner(): SpawnRunner {
  return async (cmd, args) => {
    const { spawn } = await import('node:child_process');
    return new Promise((resolvePromise) => {
      const child = spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout }));
      child.on('error', () => resolvePromise({ code: 127, stdout: '' }));
    });
  };
}
