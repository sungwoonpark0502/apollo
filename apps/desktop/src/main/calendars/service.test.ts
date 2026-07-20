import { describe, expect, it, vi } from 'vitest';
import { applyCalendarCrud, type CalendarsState } from './service';

function base(): CalendarsState {
  return {
    active: [{ id: 'default', name: 'Personal', color: '#D97757', kind: 'local', readOnly: false }],
    defaultCalendarId: 'default',
  };
}
const noEvents = { eventCount: () => 0, reassign: vi.fn(), newId: () => 'cal-1' };

describe('calendars CRUD reducer', () => {
  it('creates a local calendar with a fresh id', () => {
    const { state, result } = applyCalendarCrud(base(), { op: 'create', name: 'Work', color: '#4C8BF5' }, noEvents);
    expect(result.ok).toBe(true);
    expect(state.active).toHaveLength(2);
    expect(state.active[1]).toMatchObject({ id: 'cal-1', name: 'Work', color: '#4C8BF5', kind: 'local', readOnly: false });
  });

  it('renames', () => {
    let s = base();
    ({ state: s } = applyCalendarCrud(s, { op: 'create', name: 'Work' }, noEvents));
    ({ state: s } = applyCalendarCrud(s, { op: 'rename', id: 'cal-1', name: 'Job' }, noEvents));
    expect(s.active.find((c) => c.id === 'cal-1')).toMatchObject({ name: 'Job' });
  });

  it('L5: creating without a color stores a neutral one (no user-chosen colors)', () => {
    const { state } = applyCalendarCrud(base(), { op: 'create', name: 'Work' }, noEvents);
    expect(state.active[1]!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('blocks delete of a calendar that has events without reassign', () => {
    let s = base();
    ({ state: s } = applyCalendarCrud(s, { op: 'create', name: 'Work', color: '#4C8BF5' }, noEvents));
    const { result } = applyCalendarCrud(s, { op: 'delete', id: 'cal-1' }, { eventCount: () => 3, reassign: vi.fn(), newId: () => 'x' });
    expect(result).toMatchObject({ ok: false, eventCount: 3 });
  });

  it('deletes with reassign, moving events and clearing default if needed', () => {
    let s = base();
    ({ state: s } = applyCalendarCrud(s, { op: 'create', name: 'Work', color: '#4C8BF5' }, noEvents));
    ({ state: s } = applyCalendarCrud(s, { op: 'setDefault', id: 'cal-1' }, noEvents));
    const reassign = vi.fn();
    const { state, result } = applyCalendarCrud(s, { op: 'delete', id: 'cal-1', reassignTo: 'default' }, { eventCount: () => 2, reassign, newId: () => 'x' });
    expect(result.ok).toBe(true);
    expect(reassign).toHaveBeenCalledWith('cal-1', 'default');
    expect(state.active.map((c) => c.id)).toEqual(['default']);
    expect(state.defaultCalendarId).toBe('default');
  });

  it('refuses to delete the default calendar or the last calendar', () => {
    expect(applyCalendarCrud(base(), { op: 'delete', id: 'default' }, noEvents).result.ok).toBe(false);
    let s = base();
    ({ state: s } = applyCalendarCrud(s, { op: 'create', name: 'Work', color: '#4C8BF5' }, noEvents));
    // deleting the only non-default is fine; deleting default still refused
    expect(applyCalendarCrud(s, { op: 'delete', id: 'default' }, noEvents).result.ok).toBe(false);
  });

  it('rejects an invalid reassign target', () => {
    let s = base();
    ({ state: s } = applyCalendarCrud(s, { op: 'create', name: 'Work', color: '#4C8BF5' }, noEvents));
    const { result } = applyCalendarCrud(s, { op: 'delete', id: 'cal-1', reassignTo: 'ghost' }, { eventCount: () => 1, reassign: vi.fn(), newId: () => 'x' });
    expect(result).toMatchObject({ ok: false, error: 'invalidReassign' });
  });

  it('setDefault requires the calendar to exist', () => {
    expect(applyCalendarCrud(base(), { op: 'setDefault', id: 'ghost' }, noEvents).result.ok).toBe(false);
    expect(applyCalendarCrud(base(), { op: 'setDefault', id: 'default' }, noEvents).result.ok).toBe(true);
  });
});
