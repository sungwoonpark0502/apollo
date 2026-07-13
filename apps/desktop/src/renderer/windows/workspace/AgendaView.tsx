import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { STRINGS, type OccurrenceDTO } from '@apollo/shared';
import { useDataSync } from '../../lib/useLive';
import { EventEditorModal, type EditorInitial } from './EventEditorModal';
import { ScopeDialog } from './ScopeDialog';

const AGENDA_DAYS = 60; // E3.2 next 60 days

export function AgendaView({ anchor, h12, localTz: _localTz }: { anchor: DateTime; h12: boolean; localTz: string }): React.JSX.Element {
  const start = useMemo(() => anchor.startOf('day'), [anchor]);
  const rangeStart = start.toMillis();
  const rangeEnd = start.plus({ days: AGENDA_DAYS }).toMillis();

  const { data: occ, reload } = useDataSync<OccurrenceDTO[]>(['event'], () =>
    window.apollo.call('events.list', { startMs: rangeStart, endMs: rangeEnd }),
  );

  const groups = useMemo(() => {
    const map = new Map<string, OccurrenceDTO[]>();
    for (const o of occ ?? []) {
      const key = DateTime.fromMillis(o.occStartTs, { zone: o.tz }).toISODate() ?? '';
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [occ]);

  const [editor, setEditor] = useState<{ initial: EditorInitial } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EditorInitial | null>(null);

  const openEditor = (o: OccurrenceDTO): void => {
    void window.apollo.call('events.get', { id: o.eventId }).then((full) => {
      setEditor({
        initial: {
          id: full.id, title: full.title,
          startIso: DateTime.fromMillis(o.occStartTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
          endIso: DateTime.fromMillis(o.occEndTs, { zone: o.tz }).toISO({ includeOffset: false }) ?? '',
          allDay: full.allDay, tz: full.tz, rrule: full.rrule,
          location: full.location ?? '', notes: full.notes ?? '', reminderMin: null,
          isRecurring: o.isRecurring, occStartTs: o.occStartTs,
        },
      });
    });
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--sp-5)' }}>
      {groups.length === 0 ? (
        <div style={{ color: 'var(--text-3)' }}>{STRINGS.workspace.today.emptyEvents}</div>
      ) : (
        groups.map(([dateIso, events]) => (
          <div key={dateIso} style={{ marginBottom: 'var(--sp-4)' }}>
            <div style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>
              {DateTime.fromISO(dateIso).toFormat('cccc, LLLL d')}
            </div>
            {events.map((o) => (
              <div key={`${o.eventId}-${o.occStartTs}`} onClick={() => openEditor(o)} style={row}>
                <span style={{ minWidth: 96, color: 'var(--text-2)', fontSize: 'var(--fs-caption)' }}>
                  {o.allDay ? STRINGS.cards.allDay : DateTime.fromMillis(o.occStartTs, { zone: o.tz }).toFormat(h12 ? 'h:mm a' : 'HH:mm')}
                </span>
                <span style={{ flex: 1 }}>{o.title}</span>
                {o.location ? <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>{o.location}</span> : null}
              </div>
            ))}
          </div>
        ))
      )}

      {editor ? (
        <EventEditorModal
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSave={(r) => {
            void window.apollo
              .call('events.update', {
                id: r.id as string,
                patch: { title: r.title, startIso: r.startIso, endIso: r.endIso, tz: r.tz, allDay: r.allDay, rrule: r.rrule, location: r.location || null, notes: r.notes || null, reminderMin: r.reminderMin },
                scope: editor.initial.isRecurring ? 'single' : 'all',
                ...(editor.initial.occStartTs !== undefined ? { occStartTs: editor.initial.occStartTs } : {}),
              })
              .then(() => { setEditor(null); reload(); });
          }}
          onDelete={() => {
            if (editor.initial.isRecurring) { setPendingDelete(editor.initial); setEditor(null); }
            else void window.apollo.call('events.delete', { id: editor.initial.id as string, scope: 'all' }).then(() => { setEditor(null); reload(); });
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ScopeDialog
          onCancel={() => setPendingDelete(null)}
          onChoose={(scope) => {
            void window.apollo
              .call('events.delete', { id: pendingDelete.id as string, scope, ...(pendingDelete.occStartTs !== undefined ? { occStartTs: pendingDelete.occStartTs } : {}) })
              .then(() => { setPendingDelete(null); reload(); });
          }}
        />
      ) : null}
    </div>
  );
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)', background: 'var(--surface)',
  marginBottom: 'var(--sp-1)', cursor: 'pointer',
};
