import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolCtx, ToolDef } from '@apollo/shared';
import { createRegistry } from './registry';

export function makeCtx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    now: () => new Date('2026-07-11T10:00:00-07:00'),
    tz: 'America/Los_Angeles',
    convId: 'c1',
    turnId: 't1',
    taint: false,
    userUtterances: [],
    source: 'text',
    ...over,
  };
}

const echo: ToolDef<z.ZodType<{ msg: string }>> = {
  name: 'test.echo',
  tier: 1,
  description: 'echoes',
  params: z.object({ msg: z.string() }),
  async execute(a) {
    return { llmText: `echo ${a.msg}` };
  },
};

const boom: ToolDef<z.ZodType<Record<string, never>>> = {
  name: 'test.boom',
  tier: 1,
  description: 'throws',
  params: z.object({}),
  async execute() {
    throw new Error('kaboom');
  },
};

const slow: ToolDef<z.ZodType<Record<string, never>>> = {
  name: 'test.slow',
  tier: 1,
  description: 'never resolves',
  params: z.object({}),
  execute() {
    return new Promise(() => undefined);
  },
};

describe('registry', () => {
  it('executes with validated args and records a perf span', async () => {
    const perf = vi.fn();
    const reg = createRegistry([echo], { perf });
    const res = await reg.execute('test.echo', { msg: 'hi' }, makeCtx());
    expect(res.llmText).toBe('echo hi');
    expect(perf).toHaveBeenCalledWith('t1', 'tool:test.echo', expect.any(Number));
  });

  it('returns ERROR for unknown tool and invalid args without throwing', async () => {
    const reg = createRegistry([echo]);
    expect((await reg.execute('nope.tool', {}, makeCtx())).llmText).toMatch(/^ERROR unknown tool/);
    expect((await reg.execute('test.echo', { msg: 42 }, makeCtx())).llmText).toMatch(/^ERROR invalid arguments/);
  });

  it('catches tool throws into recoverable ERROR text', async () => {
    const reg = createRegistry([boom]);
    expect((await reg.execute('test.boom', {}, makeCtx())).llmText).toMatch(/^ERROR test\.boom failed: kaboom/);
  });

  it('times out stuck tools', async () => {
    const reg = createRegistry([slow], { timeoutMsOverride: 30 });
    expect((await reg.execute('test.slow', {}, makeCtx())).llmText).toMatch(/timed out/);
  });

  it('generates anthropic tool json from zod params', () => {
    const reg = createRegistry([echo]);
    const [json] = reg.anthropicTools();
    expect(json).toMatchObject({ name: 'test.echo', description: 'echoes' });
    expect(json?.input_schema).toMatchObject({ type: 'object', required: ['msg'] });
    expect(json?.input_schema['$schema']).toBeUndefined();
  });

  it('rejects duplicate tool names at construction', () => {
    expect(() => createRegistry([echo, { ...echo }])).toThrow(/duplicate/);
  });
});
