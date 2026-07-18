import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, isDiskFullError, toErrorCode } from '@apollo/shared';
import { createRegistry } from '../tools/registry';
import { makeCtx } from '../tools/registry.test';

/** A better-sqlite3-style disk-full error (has a `.code`). */
function sqliteFull(): Error {
  const e = new Error('SQLITE_FULL: database or disk is full');
  (e as unknown as { code: string }).code = 'SQLITE_FULL';
  return e;
}

describe('J3 disk-full detection (error taxonomy)', () => {
  it('recognizes SQLITE_FULL / IOERR / readonly-moved as disk-full', () => {
    expect(isDiskFullError(sqliteFull())).toBe(true);
    expect(isDiskFullError({ code: 'SQLITE_IOERR' })).toBe(true);
    expect(isDiskFullError({ code: 'SQLITE_READONLY_DBMOVED' })).toBe(true);
    expect(isDiskFullError(new Error('nope'))).toBe(false);
    expect(isDiskFullError({ code: 'SQLITE_CONSTRAINT' })).toBe(false);
  });

  it('toErrorCode maps a raw disk-full error to DISK_FULL (never INTERNAL/crash)', () => {
    expect(toErrorCode(sqliteFull())).toBe('DISK_FULL');
    expect(toErrorCode(new AppError('DISK_FULL'))).toBe('DISK_FULL');
    expect(toErrorCode(new Error('other'))).toBe('INTERNAL');
  });
});

describe('J3 disk-full surfaces honestly through the tool boundary', () => {
  it('a tool whose write hits SQLITE_FULL re-throws AppError(DISK_FULL) instead of a recoverable ERROR result', async () => {
    const boomTool = {
      name: 'note.save',
      tier: 2 as const,
      description: 'save (disk-full test double)',
      params: z.object({ content: z.string() }),
      async execute(): Promise<never> {
        throw sqliteFull();
      },
    };
    const reg = createRegistry([boomTool]);
    await expect(reg.execute('note.save', { content: 'hi' }, makeCtx())).rejects.toMatchObject({ code: 'DISK_FULL' });
  });

  it('a normal tool error is still a recoverable ERROR result (not thrown)', async () => {
    const failTool = {
      name: 'note.save',
      tier: 2 as const,
      description: 'save (generic failure)',
      params: z.object({ content: z.string() }),
      async execute(): Promise<never> {
        throw new Error('some non-disk failure');
      },
    };
    const reg = createRegistry([failTool]);
    const res = await reg.execute('note.save', { content: 'hi' }, makeCtx());
    expect(res.llmText).toContain('ERROR');
    expect(res.llmText).not.toContain('DISK_FULL');
  });
});
