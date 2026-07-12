import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesTool } from './files';
import { createSystemTools, rankApps, scanApps, type SpawnRunner } from './system';
import { createRegistry, type Registry } from './registry';
import { makeCtx } from './registry.test';

const base = join(tmpdir(), `apollo-files-test-${process.pid}`);

describe('files.find (C7/C14.6)', () => {
  beforeEach(() => {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(base, 'docs', 'sub'), { recursive: true });
    mkdirSync(join(base, 'outside'), { recursive: true });
    writeFileSync(join(base, 'docs', 'Tax-Return-2025.pdf'), 'x');
    writeFileSync(join(base, 'docs', 'sub', 'tax notes.txt'), 'x');
    writeFileSync(join(base, 'docs', 'photo.jpg'), 'x');
    writeFileSync(join(base, 'outside', 'tax-secret.pdf'), 'x');
  });

  function reg(dirs: string[]): Registry {
    return createRegistry([createFilesTool({ getApprovedDirs: () => dirs })]);
  }

  it('finds by case-insensitive substring, only inside approved dirs', async () => {
    const res = await reg([join(base, 'docs')]).execute('files.find', { query: 'TAX' }, makeCtx());
    expect(res.llmText).toContain('Tax-Return-2025.pdf');
    expect(res.llmText).toContain('tax notes.txt');
    expect(res.llmText).not.toContain('tax-secret'); // outside approved dirs
  });

  it('applies the extension filter', async () => {
    const res = await reg([join(base, 'docs')]).execute('files.find', { query: 'tax', extension: 'pdf' }, makeCtx());
    expect(res.llmText).toContain('Tax-Return-2025.pdf');
    expect(res.llmText).not.toContain('tax notes.txt');
  });

  it('warns with no approved dirs and reports no matches cleanly', async () => {
    expect((await reg([]).execute('files.find', { query: 'x' }, makeCtx())).llmText).toMatch(/^WARNING no approved folders/);
    expect((await reg([join(base, 'docs')]).execute('files.find', { query: 'zzz-nothing' }, makeCtx())).llmText).toContain('No files matching');
  });
});

describe('system.openApp allowlist', () => {
  beforeEach(() => {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(base, 'Applications'), { recursive: true });
    for (const app of ['Spotify.app', 'Visual Studio Code.app', 'Safari.app']) {
      mkdirSync(join(base, 'Applications', app), { recursive: true });
    }
  });

  function makeReg(openPath: (p: string) => Promise<string>): Registry {
    const run: SpawnRunner = vi.fn(async () => ({ code: 0, stdout: '' }));
    return createRegistry(
      createSystemTools({ platform: 'darwin', run, openPath, listAppDirs: () => [join(base, 'Applications')] }),
    );
  }

  it('scan finds .app bundles; rank prefers exact > prefix > substring', () => {
    const apps = scanApps('darwin', [join(base, 'Applications')]);
    expect(apps.map((a) => a.name).sort()).toEqual(['Safari', 'Spotify', 'Visual Studio Code']);
    expect(rankApps(apps, 'spotify')[0]?.name).toBe('Spotify');
    expect(rankApps(apps, 'visual')[0]?.name).toBe('Visual Studio Code');
    expect(rankApps(apps, 'code')[0]?.name).toBe('Visual Studio Code');
  });

  it('opens only allowlist-resolved paths via openPath', async () => {
    const opened: string[] = [];
    const reg = makeReg(async (p) => {
      opened.push(p);
      return '';
    });
    const res = await reg.execute('system.openApp', { name: 'spotify' }, makeCtx());
    expect(res.llmText).toBe('Opening Spotify.');
    expect(opened).toEqual([join(base, 'Applications', 'Spotify.app')]);
  });

  it('no match lists 3 closest candidates instead of failing bare', async () => {
    const reg = makeReg(async () => '');
    const res = await reg.execute('system.openApp', { name: 'the garage door' }, makeCtx());
    expect(res.llmText).toMatch(/^WARNING no app matched/);
    expect(res.llmText).toContain('Safari');
  });
});

describe('system.volume / media / lock / screenshot use fixed spawn templates', () => {
  function capture(): { reg: Registry; calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: SpawnRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      if (args.includes('output volume of (get volume settings)')) return { code: 0, stdout: '40\n' };
      return { code: 0, stdout: '' };
    };
    const reg = createRegistry(
      createSystemTools({ platform: 'darwin', run, openPath: async () => '', listAppDirs: () => [], picturesDir: () => '/tmp/pics', now: () => 1234 }),
    );
    return { reg, calls };
  }

  it('volume set uses validated integer in the osascript template', async () => {
    const { reg, calls } = capture();
    const res = await reg.execute('system.volume', { op: 'set', value: 55 }, makeCtx());
    expect(res.llmText).toBe('Volume 55 percent.');
    expect(calls[0]).toEqual({ cmd: 'osascript', args: ['-e', 'set volume output volume 55'] });
  });

  it('volume up reads current then sets +10, clamped', async () => {
    const { reg, calls } = capture();
    const res = await reg.execute('system.volume', { op: 'up' }, makeCtx());
    expect(res.llmText).toBe('Volume 50 percent.');
    expect(calls[1]?.args[1]).toBe('set volume output volume 50');
  });

  it('rejects out-of-range values at the schema (never reaches spawn)', async () => {
    const { reg, calls } = capture();
    const res = await reg.execute('system.volume', { op: 'set', value: 400 }, makeCtx());
    expect(res.llmText).toMatch(/^ERROR invalid arguments/);
    expect(calls).toHaveLength(0);
  });

  it('screenshot targets Pictures/Apollo with a timestamped name', async () => {
    const { reg, calls } = capture();
    const res = await reg.execute('system.screenshot', {}, makeCtx());
    expect(res.llmText).toContain('/tmp/pics/Apollo/apollo-1234.png');
    expect(calls.at(-1)?.cmd).toBe('screencapture');
    expect(calls.at(-1)?.args).toEqual(['-x', '/tmp/pics/Apollo/apollo-1234.png']);
  });

  it('media reports no player gracefully; lock uses CGSession', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: SpawnRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: 'no-player' };
    };
    const reg = createRegistry(createSystemTools({ platform: 'darwin', run, openPath: async () => '', listAppDirs: () => [] }));
    expect((await reg.execute('system.media', { op: 'playpause' }, makeCtx())).llmText).toMatch(/^WARNING no media player/);

    await reg.execute('system.lock', {}, makeCtx());
    expect(calls.at(-1)?.cmd).toContain('CGSession');
    expect(calls.at(-1)?.args).toEqual(['-suspend']);
  });
});
