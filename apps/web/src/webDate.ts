import { fmtDate } from '@apollo/shared';

/** Minimal date math for the web calendar — pure and tested. */
export interface DayCell {
  iso: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 6 fixed weeks (42 cells) starting Monday, so the grid never reflows. */
export function monthGrid(year: number, month1: number, todayIso: string): DayCell[] {
  const first = new Date(year, month1 - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-start offset
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month1 - 1, 1 - lead + i);
    cells.push({ iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month1 - 1, isToday: isoOf(d) === todayIso });
  }
  return cells;
}

export function monthLabel(year: number, month1: number): string {
  return fmtDate(new Date(year, month1 - 1, 1).getTime(), 'month-year');
}
