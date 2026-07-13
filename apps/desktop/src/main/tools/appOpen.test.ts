import { describe, expect, it, vi } from 'vitest';
import { createAppOpenTool } from './appOpen';
import { type ToolCtx } from '@apollo/shared';

const ctx = {} as ToolCtx;

describe('app.open tool (E8)', () => {
  it('opens the requested view and reports it', async () => {
    const openWorkspace = vi.fn();
    const tool = createAppOpenTool({ openWorkspace });
    const res = await tool.execute({ view: 'calendar', dateIso: '2026-07-20' }, ctx);
    expect(openWorkspace).toHaveBeenCalledWith({ view: 'calendar', dateIso: '2026-07-20' });
    expect(res.llmText).toBe('Opened calendar.');
  });

  it('omits optional fields when absent', async () => {
    const openWorkspace = vi.fn();
    const tool = createAppOpenTool({ openWorkspace });
    await tool.execute({ view: 'notes' }, ctx);
    expect(openWorkspace).toHaveBeenCalledWith({ view: 'notes' });
  });

  it('is Tier 2 and not networked (no confirmation, direct UI action)', () => {
    const tool = createAppOpenTool({ openWorkspace: vi.fn() });
    expect(tool.tier).toBe(2);
    expect(tool.networked).toBeUndefined();
  });

  it('rejects an unknown view via its zod schema', () => {
    const tool = createAppOpenTool({ openWorkspace: vi.fn() });
    expect(tool.params.safeParse({ view: 'dashboard' }).success).toBe(false);
    expect(tool.params.safeParse({ view: 'today' }).success).toBe(true);
  });
});
