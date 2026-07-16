import React from 'react';
import type { CardPayload } from '@apollo/shared';
import { TextCard } from './TextCard';
import { TimerCard } from './TimerCard';
import { WeatherCard } from './WeatherCard';
import { ConfirmCard } from './ConfirmCard';
import { BatchConfirmCard } from './BatchConfirmCard';
import { LinkPreviewCard } from './LinkPreviewCard';
import { SyncConflictCard } from './SyncConflictCard';
import { EventCard, EventListCard } from './EventCard';
import { EmailListCard, EmailDetailCard, DraftCard } from './EmailCard';
import { BriefCard } from './BriefCard';
import { RecallListCard } from './RecallListCard';

/** One component per CardPayload.kind (C18); kinds from later phases render as text for now. */
export function CardView({ card }: { card: CardPayload }): React.JSX.Element {
  switch (card.kind) {
    case 'text':
      return <TextCard body={card.body} />;
    case 'timer':
      return <TimerCard id={card.id} label={card.label} endsAt={card.endsAt} />;
    case 'weather':
      return <WeatherCard place={card.place} now={card.now} days={card.days} />;
    case 'confirm':
      return <ConfirmCard confirmationId={card.confirmationId} action={card.action} expiresAt={card.expiresAt} />;
    case 'batchConfirm':
      return <BatchConfirmCard confirmationId={card.confirmationId} actions={card.actions} expiresAt={card.expiresAt} />;
    case 'event':
      return <EventCard event={card.event} />;
    case 'eventList':
      return <EventListCard title={card.title} events={card.events} />;
    case 'newsList':
      return (
        <div>
          {card.items.map((it) => (
            <div key={it.url} style={{ marginBottom: 'var(--sp-2)' }}>
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-1)', textDecoration: 'none', fontWeight: 500 }}>
                {it.title}
              </a>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{it.source}</div>
            </div>
          ))}
        </div>
      );
    case 'emailList':
      return <EmailListCard items={card.items} />;
    case 'emailDetail':
      return <EmailDetailCard email={card.email} />;
    case 'draft':
      return <DraftCard to={card.to} subject={card.subject} body={card.body} />;
    case 'brief':
      return <BriefCard sections={card.sections} />;
    case 'recallList':
      return <RecallListCard items={card.items} />;
    case 'linkPreview':
      return <LinkPreviewCard url={card.url} title={card.title} summary={card.summary} siteName={card.siteName} />;
    case 'syncConflict':
      return <SyncConflictCard eventId={card.eventId} localTitle={card.localTitle} localStart={card.localStart} remoteTitle={card.remoteTitle} remoteStart={card.remoteStart} />;
    default:
      return <TextCard body={JSON.stringify(card, null, 2)} />;
  }
}

export function CardShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--sp-4)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {children}
    </div>
  );
}
