import React from 'react';
import { type DateTime } from 'luxon';

// Full agenda (next 60 days grouped by day) lands in milestone 5.4.
export function AgendaView({ anchor: _a, h12: _h, localTz: _tz }: { anchor: DateTime; h12: boolean; localTz: string }): React.JSX.Element {
  return <div style={{ padding: 'var(--sp-6)', color: 'var(--text-3)' }}>Agenda</div>;
}
