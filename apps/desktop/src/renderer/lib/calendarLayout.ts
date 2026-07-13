import { DateTime } from 'luxon';

/**
 * Pure calendar layout helpers (E9 unit-tested): month-grid generation for both
 * weekStarts across DST months, and week-view overlap lane assignment. No React,
 * no IO — deterministic given inputs.
 */

export interface MonthCell {
  dateIso: string;       // yyyy-MM-dd
  day: number;           // 1..31
  inMonth: boolean;      // belongs to the displayed month
  isToday: boolean;
  weekday: number;       // 0..6 in the grid's own order
}

/** 6x7 grid (always 42 cells) for the month containing `anchorIso`. */
export function monthGrid(anchorIso: string, weekStart: 'monday' | 'sunday', todayIso: string): MonthCell[] {
  const anchor = DateTime.fromISO(anchorIso);
  const first = anchor.startOf('month');
  // luxon weekday: 1=Mon..7=Sun. Column 0 is weekStart.
  const startShift = weekStart === 'monday' ? (first.weekday - 1) : (first.weekday % 7);
  const gridStart = first.minus({ days: startShift });
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = gridStart.plus({ days: i });
    cells.push({
      dateIso: d.toISODate() ?? '',
      day: d.day,
      inMonth: d.month === anchor.month,
      isToday: (d.toISODate() ?? '') === todayIso,
      weekday: i % 7,
    });
  }
  return cells;
}

/** Weekday header labels in the grid's order. */
export function weekdayHeaders(weekStart: 'monday' | 'sunday'): string[] {
  const base = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return weekStart === 'monday' ? base : [base[6] as string, ...base.slice(0, 6)];
}

export interface LaneItem {
  id: string;
  startMs: number;
  endMs: number;
}
export interface LaidOut extends LaneItem {
  lane: number;   // 0-based column within its overlap cluster
  lanes: number;  // total lanes in the cluster (for width = 1/lanes)
}

/**
 * Assigns side-by-side lanes to overlapping events (E3.2 week view). Pure:
 * sorts by start, greedily packs into lanes, and every item in an overlap
 * cluster reports the cluster's max lane count so widths tile without gaps.
 */
export function layoutOverlaps(items: LaneItem[]): LaidOut[] {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: LaidOut[] = [];
  let cluster: LaidOut[] = [];
  let clusterEnd = -Infinity;

  const flush = (): void => {
    const lanes = cluster.reduce((m, it) => Math.max(m, it.lane + 1), 0);
    for (const it of cluster) it.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };

  for (const it of sorted) {
    if (it.startMs >= clusterEnd && cluster.length > 0) flush();
    // find the lowest free lane among items in the current cluster that still overlap
    const laneEnds: number[] = [];
    for (const c of cluster) {
      if (c.endMs > it.startMs) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.endMs);
    }
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane]! > it.startMs) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMs);
  }
  if (cluster.length > 0) flush();
  return out;
}

/** Snap a millisecond offset to a 15-minute grid (E3.2 drag create/resize). */
export function snap15(ms: number): number {
  const step = 15 * 60 * 1000;
  return Math.round(ms / step) * step;
}

/** Stagger delay for Stage row entrance (E4): 35ms per row, pure. */
export function staggerDelayMs(rowIndex: number, perRow = 35): number {
  return Math.max(0, rowIndex) * perRow;
}
