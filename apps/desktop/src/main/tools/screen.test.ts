import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@apollo/shared';
import { createScreenTool, readScreenContext } from './screen';
import { type SpawnRunner } from './system';

const ctx: ToolCtx = {
  now: () => new Date(),
  tz: 'America/Los_Angeles',
  convId: 'c',
  turnId: 't',
  taint: false,
  userUtterances: [],
  source: 'text',
};

function runner(code: number, stdout: string): SpawnRunner {
  return vi.fn(async () => ({ code, stdout }));
}

describe('screen.context (C7 Phase 4)', () => {
  it('parses app / window title / selected text from osascript output', async () => {
    const res = await readScreenContext({ platform: 'darwin', run: runner(0, 'Safari\nApollo — spec\nhello world') });
    expect(res).toEqual({ app: 'Safari', title: 'Apollo — spec', selectedText: 'hello world', permissionMissing: false });
  });

  it('reports permission missing when osascript fails', async () => {
    const res = await readScreenContext({ platform: 'darwin', run: runner(1, '') });
    expect(res.permissionMissing).toBe(true);
  });

  it('tool explains how to grant permission when missing', async () => {
    const tool = createScreenTool({ platform: 'darwin', run: runner(1, '') });
    const r = await tool.execute({}, ctx);
    expect(r.llmText).toMatch(/Accessibility/);
  });

  it('tool summarizes context when available', async () => {
    const tool = createScreenTool({ platform: 'darwin', run: runner(0, 'Mail\nInbox\nRe: lease') });
    const r = await tool.execute({}, ctx);
    expect(r.llmText).toContain('Mail');
    expect(r.llmText).toContain('Re: lease');
  });

  it('non-macOS returns empty context without claiming a permission problem', async () => {
    const res = await readScreenContext({ platform: 'win32', run: runner(0, '') });
    expect(res.permissionMissing).toBe(false);
  });
});
