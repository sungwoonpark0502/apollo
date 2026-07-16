import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { fmtDateIso, STRINGS } from '@apollo/shared';
import { Modal } from './Modal';
import { buildRRule, detectPreset, isValidRRule, type RecurrencePreset } from '../../lib/recurrence';

export interface EditorInitial {
  id?: string;
  title: string;
  startIso: string;         // local-zone ISO for the datetime-local inputs
  endIso: string;
  allDay: boolean;
  tz: string;
  rrule: string | null;
  location: string;
  notes: string;
  reminderMin: number | null;
  isRecurring: boolean;     // whether editing touches a recurring series
  occStartTs?: number;      // for scope=single edits
}

export interface EditorResult {
  id?: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  tz: string;
  rrule: string | null;
  location: string;
  notes: string;
  reminderMin: number | null;
}

const COMMON_TZS = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'UTC', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney',
];

export function EventEditorModal({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial: EditorInitial;
  onSave: (r: EditorResult) => void;
  onDelete?: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const e = STRINGS.workspace.editor;
  const [title, setTitle] = useState(initial.title);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startIso, setStartIso] = useState(initial.startIso.slice(0, 16));
  const [endIso, setEndIso] = useState(initial.endIso.slice(0, 16));
  const [tz, setTz] = useState(initial.tz);
  const [preset, setPreset] = useState<RecurrencePreset>(detectPreset(initial.rrule, initial.startIso));
  const [customRrule, setCustomRrule] = useState(preset === 'custom' ? (initial.rrule ?? '') : '');
  const [location, setLocation] = useState(initial.location);
  const [notes, setNotes] = useState(initial.notes);
  const [reminderMin, setReminderMin] = useState<string>(initial.reminderMin?.toString() ?? '');

  const weekdayLabel = useMemo(() => fmtDateIso(startIso, 'weekday-long'), [startIso]);
  const dayOfMonth = useMemo(() => DateTime.fromISO(startIso).day, [startIso]);

  const customValid = preset !== 'custom' || isValidRRule(customRrule);
  const timesValid = DateTime.fromISO(startIso).isValid && DateTime.fromISO(endIso).isValid && endIso >= startIso;
  const canSave = title.trim().length > 0 && timesValid && customValid;

  const tzOptions = useMemo(() => {
    const set = new Set([tz, ...COMMON_TZS]);
    return [...set];
  }, [tz]);

  const save = (): void => {
    if (!canSave) return;
    onSave({
      id: initial.id,
      title: title.trim(),
      startIso,
      endIso,
      allDay,
      tz,
      rrule: buildRRule(preset, startIso, customRrule),
      location: location.trim(),
      notes: notes.trim(),
      reminderMin: reminderMin.trim() ? Math.max(0, parseInt(reminderMin, 10) || 0) : null,
    });
  };

  return (
    <Modal onClose={onClose} width={460}>
      <h2 style={{ fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-4)' }}>{e.title}</h2>

      <Field label={e.titleField}>
        <input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} style={input} />
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-body)' }}>
        <input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} />
        {e.allDay}
      </label>

      <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
        <Field label={e.start}>
          <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? startIso.slice(0, 10) : startIso} onChange={(ev) => setStartIso(allDay ? `${ev.target.value}T00:00` : ev.target.value)} style={input} />
        </Field>
        <Field label={e.end}>
          <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? endIso.slice(0, 10) : endIso} onChange={(ev) => setEndIso(allDay ? `${ev.target.value}T23:59` : ev.target.value)} style={input} />
        </Field>
      </div>
      {!timesValid ? <ErrorLine text={e.invalidTime} /> : null}

      <Field label={e.timezone}>
        <select value={tz} onChange={(ev) => setTz(ev.target.value)} style={input}>
          {tzOptions.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </Field>

      <Field label={e.recurrence}>
        <select value={preset} onChange={(ev) => setPreset(ev.target.value as RecurrencePreset)} style={input}>
          <option value="none">{e.recNone}</option>
          <option value="daily">{e.recDaily}</option>
          <option value="weekly">{e.recWeekly(weekdayLabel)}</option>
          <option value="weekdays">{e.recWeekdays}</option>
          <option value="monthly">{e.recMonthly(dayOfMonth)}</option>
          <option value="custom">{e.recCustom}</option>
        </select>
      </Field>
      {preset === 'custom' ? (
        <>
          <input value={customRrule} onChange={(ev) => setCustomRrule(ev.target.value)} placeholder="FREQ=WEEKLY;BYDAY=MO,WE" style={input} />
          {!customValid ? <ErrorLine text={e.invalidRrule} /> : null}
        </>
      ) : null}

      <Field label={e.location}>
        <input value={location} onChange={(ev) => setLocation(ev.target.value)} style={input} />
      </Field>

      <Field label={e.notes}>
        <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} />
      </Field>

      <Field label={e.reminder}>
        <input type="number" min={0} value={reminderMin} onChange={(ev) => setReminderMin(ev.target.value)} style={{ ...input, width: 120 }} />
      </Field>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)', justifyContent: 'space-between' }}>
        <div>
          {onDelete ? (
            <button onClick={onDelete} style={{ ...ghost, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{e.delete}</button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button onClick={onClose} style={ghost}>{e.cancel}</button>
          <button onClick={save} disabled={!canSave} style={{ ...primary, opacity: canSave ? 1 : 0.5 }}>{e.save}</button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--sp-3)', flex: 1 }}>
      <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>{label}</span>
      {children}
    </label>
  );
}

function ErrorLine({ text }: { text: string }): React.JSX.Element {
  return <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-caption)', marginTop: 'calc(-1 * var(--sp-2))', marginBottom: 'var(--sp-2)' }}>{text}</div>;
}

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)',
  color: 'var(--text-1)',
  outline: 'none',
};
const primary: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-5)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const ghost: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
