import React, { useState } from 'react';
import { STRINGS, type EmailDetailSanitized, type EmailSummary } from '@apollo/shared';
import { buttonStyle } from './TimerCard';

export function DraftCard({ to, subject, body }: { to: string[]; subject: string; body: string }): React.JSX.Element {
  const [sent, setSent] = useState(false);

  const send = (): void => {
    // Sending goes through the confirm flow; the model re-issues email.send.
    void window.apollo.call('agent.userMessage', {
      text: `send that draft to ${to.join(', ')}`,
      source: 'text',
      convId: `draft-${subject}`,
    });
    setSent(true);
  };

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
        {STRINGS.cards.to}: {to.join(', ')}
      </div>
      <div style={{ fontSize: 'var(--fs-title)', color: 'var(--text-1)', margin: 'var(--sp-1) 0' }}>{subject}</div>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', whiteSpace: 'pre-wrap', marginBottom: 'var(--sp-3)' }}>{body}</div>
      {!sent ? (
        <button onClick={send} style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
          {STRINGS.cards.send}
        </button>
      ) : (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{STRINGS.confirm.askShort}</div>
      )}
    </div>
  );
}

export function EmailListCard({ items }: { items: EmailSummary[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      {items.slice(0, 8).map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              marginTop: 6,
              flexShrink: 0,
              background: m.unread ? 'var(--accent)' : 'transparent',
            }}
            aria-label={m.unread ? STRINGS.cards.unread : undefined}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)', fontWeight: m.unread ? 600 : 400 }}>{m.subject}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.from} — {m.snippet}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmailDetailCard({ email }: { email: EmailDetailSanitized }): React.JSX.Element {
  const [requested, setRequested] = useState(false);

  const loadImages = (): void => {
    // Re-reads the message with images allowed; a fresh emailDetail card arrives.
    void window.apollo.call('agent.userMessage', {
      text: `show images for email ${email.id}`,
      source: 'text',
      convId: `card-${email.id}`,
    });
    setRequested(true);
  };

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{email.from}</div>
      <div style={{ fontSize: 'var(--fs-title)', color: 'var(--text-1)', margin: 'var(--sp-1) 0 var(--sp-2)' }}>{email.subject}</div>
      <iframe
        title={email.subject}
        // sandbox with no allow-* tokens: no scripts, no forms, no top navigation
        sandbox=""
        srcDoc={email.safeHtml}
        style={{ width: '100%', height: 220, border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: '#fff' }}
      />
      {email.remoteImagesBlocked > 0 && !requested ? (
        <button onClick={loadImages} style={{ ...buttonStyle, marginTop: 'var(--sp-2)' }}>
          {STRINGS.cards.loadImages(email.remoteImagesBlocked)}
        </button>
      ) : null}
    </div>
  );
}
