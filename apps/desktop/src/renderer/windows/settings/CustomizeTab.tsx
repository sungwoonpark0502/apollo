import React from 'react';
import { STRINGS } from '@apollo/shared';
import { AccountsTab } from './AccountsTab';
import { Section } from './TimeFocusTab';

/**
 * Connectors and sources — the parts of Apollo the user extends themselves.
 *
 * Deliberately only real things: the Google connector and the news feeds that
 * actually drive the brief. Skills/plugins would need an execution model,
 * permission story, and distribution channel before a screen for them means
 * anything, so they are tracked in HUMAN_TODO rather than shipped as an empty
 * shell that implies capability the app does not have.
 */
export function CustomizeTab(): React.JSX.Element {
  const c = STRINGS.settings.customize;
  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' }}>{c.title}</h2>
      <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: '0 0 var(--sp-5)' }}>{c.subtitle}</p>

      <Section title={c.connectors} body={c.connectorsBody}>
        <AccountsTab embedded />
      </Section>
    </div>
  );
}
