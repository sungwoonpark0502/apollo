import React, { useState } from 'react';
import { CALENDAR_PALETTE, STRINGS, type CalendarCollection } from '@apollo/shared';
import { useSettings } from '../../lib/useLive';

/** I1 local calendar collections manager: create, rename, recolor, set default, delete (with reassign). */
export function CalendarsTab(): React.JSX.Element {
  const c = STRINGS.settings.calendars;
  const settings = useSettings();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(CALENDAR_PALETTE[1]!);
  const [deleting, setDeleting] = useState<{ cal: CalendarCollection; count: number } | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('default');
  const [error, setError] = useState<string | null>(null);

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;
  const calendars = settings.calendars.active;
  const defaultId = settings.calendars.defaultCalendarId;

  const crud = (req: Parameters<typeof window.apollo.call<'calendars.crud'>>[1]): Promise<void> =>
    window.apollo.call('calendars.crud', req).then((r) => {
      if (!r.ok) {
        if (r.eventCount !== undefined) {
          const cal = calendars.find((x) => x.id === (req as { id: string }).id);
          if (cal) {
            setReassignTo(calendars.find((x) => x.id !== cal.id)?.id ?? 'default');
            setDeleting({ cal, count: r.eventCount });
          }
        } else {
          setError(r.error ?? 'failed');
        }
      }
    });

  return (
    <div style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' }}>{c.title}</h2>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body)', margin: '0 0 var(--sp-4)' }}>{c.subtitle}</p>

      {calendars.map((cal) => (
        <div key={cal.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border)' }}>
          <ColorSwatch
            value={cal.color}
            onChange={(color) => void crud({ op: 'recolor', id: cal.id, color })}
          />
          <input
            value={cal.name}
            onChange={(e) => void crud({ op: 'rename', id: cal.id, name: e.target.value })}
            style={{ ...input, flex: 1 }}
            disabled={cal.kind === 'google' && cal.readOnly}
          />
          {cal.kind === 'google' ? <Badge text={c.googleBadge} /> : null}
          {cal.readOnly ? <Badge text={c.readOnlyBadge} /> : null}
          {cal.id === defaultId ? (
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--accent)' }}>{c.isDefault}</span>
          ) : (
            <button onClick={() => void crud({ op: 'setDefault', id: cal.id })} style={linkBtn}>{c.makeDefault}</button>
          )}
          {cal.id !== 'default' ? (
            <button onClick={() => void crud({ op: 'delete', id: cal.id })} style={{ ...linkBtn, color: 'var(--danger)' }}>{c.delete}</button>
          ) : null}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
        <ColorSwatch value={newColor} onChange={setNewColor} />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={c.newNamePlaceholder}
          style={{ ...input, flex: 1 }}
        />
        <button
          onClick={() => {
            const name = newName.trim();
            if (!name) return;
            void crud({ op: 'create', name, color: newColor }).then(() => setNewName(''));
          }}
          style={primary}
        >
          {c.addNew}
        </button>
      </div>

      {error ? <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-caption)', marginTop: 'var(--sp-2)' }}>{error}</div> : null}

      {deleting ? (
        <div style={{ marginTop: 'var(--sp-4)', padding: 'var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)' }}>
          <div style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--sp-2)' }}>{c.deleteHasEvents(deleting.count)}</div>
          <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} style={{ ...input, marginBottom: 'var(--sp-2)' }}>
            {calendars.filter((x) => x.id !== deleting.cal.id && !x.readOnly).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button onClick={() => setDeleting(null)} style={ghost}>{c.cancel}</button>
            <button
              onClick={() => {
                const id = deleting.cal.id;
                setDeleting(null);
                void crud({ op: 'delete', id, reassignTo });
              }}
              style={{ ...primary, background: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              {c.reassignConfirm}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ColorSwatch({ value, onChange }: { value: string; onChange: (color: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: 20, height: 20, borderRadius: '50%', background: value, border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }}
        aria-label="Color"
      />
      {open ? (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{ position: 'absolute', top: 24, left: 0, zIndex: 20, display: 'grid', gridTemplateColumns: 'repeat(5, 20px)', gap: 4, padding: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', boxShadow: 'var(--shadow-card)' }}
        >
          {CALENDAR_PALETTE.map((p) => (
            <button
              key={p}
              onClick={() => { onChange(p); setOpen(false); }}
              style={{ width: 20, height: 20, borderRadius: '50%', background: p, border: p === value ? '2px solid var(--text-1)' : '1px solid var(--border)', cursor: 'pointer' }}
              aria-label={p}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Badge({ text }: { text: string }): React.JSX.Element {
  return <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', padding: '0 6px' }}>{text}</span>;
}

const input: React.CSSProperties = {
  boxSizing: 'border-box', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
  padding: 'var(--sp-2) var(--sp-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)',
  background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
const primary: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
};
const ghost: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
};
