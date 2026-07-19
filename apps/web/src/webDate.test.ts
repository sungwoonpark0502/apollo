import { describe, expect, it } from 'vitest';
import { isoOf, monthGrid } from './webDate';

describe('web month grid', () => {
  it('always renders 6 full Monday-start weeks', () => {
    const cells = monthGrid(2026, 7, '2026-07-19');
    expect(cells).toHaveLength(42);
    // July 1 2026 is a Wednesday → the grid starts Monday June 29.
    expect(cells[0]!.iso).toBe('2026-06-29');
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.find((c) => c.isToday)?.iso).toBe('2026-07-19');
  });

  it('handles a month starting on Monday without a dead lead week', () => {
    // June 2026 starts on a Monday.
    expect(monthGrid(2026, 6, 'x')[0]!.iso).toBe('2026-06-01');
  });

  it('crosses year boundaries', () => {
    const jan = monthGrid(2026, 1, 'x');
    expect(jan[0]!.iso).toBe('2025-12-29');
  });

  it('isoOf pads correctly', () => {
    expect(isoOf(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
