import { describe, expect, it } from 'vitest';
import { layoutOverlaps, monthGrid, snap15, staggerDelayMs, weekdayHeaders } from './calendarLayout';

describe('monthGrid (E9)', () => {
  it('always yields 6x7 = 42 cells', () => {
    expect(monthGrid('2026-07-13', 'sunday', '2026-07-13')).toHaveLength(42);
    expect(monthGrid('2026-02-01', 'monday', '2026-07-13')).toHaveLength(42);
  });

  it('sunday-start July 2026 begins on Sun Jun 28 and marks today', () => {
    const cells = monthGrid('2026-07-13', 'sunday', '2026-07-13');
    expect(cells[0]!.dateIso).toBe('2026-06-28');
    expect(cells[0]!.inMonth).toBe(false);
    const today = cells.find((c) => c.isToday);
    expect(today?.dateIso).toBe('2026-07-13');
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('monday-start July 2026 begins on Mon Jun 29', () => {
    const cells = monthGrid('2026-07-13', 'monday', '2026-07-13');
    expect(cells[0]!.dateIso).toBe('2026-06-29');
  });

  it('DST spring-forward month (US March 2026) stays 42 cells with correct dates', () => {
    const cells = monthGrid('2026-03-15', 'sunday', '2026-07-13');
    expect(cells).toHaveLength(42);
    expect(cells[0]!.dateIso).toBe('2026-03-01');
    // March 8 (DST) present exactly once
    expect(cells.filter((c) => c.dateIso === '2026-03-08')).toHaveLength(1);
  });

  it('DST fall-back month (US November 2026) is contiguous with no gaps', () => {
    const cells = monthGrid('2026-11-10', 'sunday', '2026-07-13');
    for (let i = 1; i < cells.length; i++) {
      const prev = new Date(`${cells[i - 1]!.dateIso}T12:00:00Z`).getTime();
      const cur = new Date(`${cells[i]!.dateIso}T12:00:00Z`).getTime();
      expect(Math.round((cur - prev) / 86_400_000)).toBe(1);
    }
  });

  it('weekday headers reorder by weekStart', () => {
    expect(weekdayHeaders('monday')[0]).toBe('Mon');
    expect(weekdayHeaders('sunday')[0]).toBe('Sun');
    expect(weekdayHeaders('sunday')).toHaveLength(7);
  });
});

describe('layoutOverlaps (E9 week-view lanes)', () => {
  const h = (n: number): number => n * 3_600_000;

  it('non-overlapping events all get lane 0 of 1', () => {
    const out = layoutOverlaps([
      { id: 'a', startMs: h(9), endMs: h(10) },
      { id: 'b', startMs: h(11), endMs: h(12) },
    ]);
    expect(out.every((o) => o.lane === 0 && o.lanes === 1)).toBe(true);
  });

  it('two overlapping events split into two lanes', () => {
    const out = layoutOverlaps([
      { id: 'a', startMs: h(9), endMs: h(11) },
      { id: 'b', startMs: h(10), endMs: h(12) },
    ]);
    const a = out.find((o) => o.id === 'a')!;
    const b = out.find((o) => o.id === 'b')!;
    expect(a.lane).toBe(0);
    expect(b.lane).toBe(1);
    expect(a.lanes).toBe(2);
    expect(b.lanes).toBe(2);
  });

  it('a third event reuses a freed lane when its predecessor ended', () => {
    const out = layoutOverlaps([
      { id: 'a', startMs: h(9), endMs: h(10) },
      { id: 'b', startMs: h(9), endMs: h(12) },
      { id: 'c', startMs: h(10), endMs: h(11) }, // overlaps b, but a is done → lane 0
    ]);
    const c = out.find((o) => o.id === 'c')!;
    expect(c.lane).toBe(0);
    expect(out.find((o) => o.id === 'b')!.lanes).toBe(2);
  });

  it('separate clusters do not inflate each other lane counts', () => {
    const out = layoutOverlaps([
      { id: 'a', startMs: h(9), endMs: h(11) },
      { id: 'b', startMs: h(10), endMs: h(12) },
      { id: 'c', startMs: h(14), endMs: h(15) },
    ]);
    expect(out.find((o) => o.id === 'c')!.lanes).toBe(1);
  });
});

describe('snap15 + stagger (E9)', () => {
  it('snaps to the nearest 15 minutes', () => {
    expect(snap15(7 * 60_000)).toBe(0);
    expect(snap15(8 * 60_000)).toBe(15 * 60_000);
    expect(snap15(22 * 60_000)).toBe(15 * 60_000);
    expect(snap15(23 * 60_000)).toBe(30 * 60_000);
  });
  it('stagger is 35ms per row, clamped at 0', () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(3)).toBe(105);
    expect(staggerDelayMs(-2)).toBe(0);
  });
});
