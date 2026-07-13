import React from 'react';
import { type Settings } from '@apollo/shared';

// Full Month/Week/Agenda implementation lands in milestones 5.3–5.4.
export function CalendarView({ settings: _settings, initialDateIso: _d }: { settings: Settings | null; initialDateIso?: string }): React.JSX.Element {
  return <div style={{ padding: 'var(--sp-6)', color: 'var(--text-3)' }}>Calendar</div>;
}
