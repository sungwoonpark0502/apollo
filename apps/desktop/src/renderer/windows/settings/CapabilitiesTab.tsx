import React from 'react';
import { STRINGS } from '@apollo/shared';
import { VoiceTab } from './VoiceTab';
import { ProactiveTab } from './ProactiveTab';
import { CalendarsTab } from './CalendarsTab';
import { Section } from './TimeFocusTab';

/**
 * What Apollo is allowed to do. Voice, proactive nudges, and calendars used to
 * be three sibling tabs, which split one question ("what can it do?") across
 * three places. They are composed here rather than rewritten, so their existing
 * behavior and tests are untouched — each renders with `embedded` so only this
 * page owns the display-size heading.
 */
export function CapabilitiesTab(): React.JSX.Element {
  const c = STRINGS.settings.capabilities;
  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-1)' }}>{c.title}</h2>
      <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: '0 0 var(--sp-5)' }}>{c.subtitle}</p>

      <Section title={c.voiceSection}>
        <VoiceTab embedded />
      </Section>

      <Section title={c.proactiveSection}>
        <ProactiveTab embedded />
      </Section>

      <Section title={c.calendarSection}>
        <CalendarsTab embedded />
      </Section>
    </div>
  );
}
