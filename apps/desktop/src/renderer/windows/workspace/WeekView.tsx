import React from 'react';
import { type DateTime } from 'luxon';

// Full week timeline with drag create/move/resize lands in milestone 5.4.
export function WeekView({ anchor: _a, h12: _h, localTz: _tz }: { anchor: DateTime; h12: boolean; localTz: string }): React.JSX.Element {
  return <div style={{ padding: 'var(--sp-6)', color: 'var(--text-3)' }}>Week</div>;
}
