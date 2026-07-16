import { z } from 'zod';
// Type-only imports from agent.ts keep this module free of a runtime cycle
// (cards.ts is evaluated by agent.ts for cardPayloadSchema). The suggestion
// sub-schemas are defined locally below rather than imported at runtime.
import { type ConfirmAction, type SuggestionDTO } from './agent';

// ---- DTO interfaces (verbatim contracts, C3) ----

export interface EventDTO {
  id: string; title: string; startTs: number; endTs: number | null;
  tz: string; allDay: boolean; rrule: string | null; location: string | null; notes: string | null;
  calendarId: string; color: string; // I1: calendar membership + derived color
}
export interface WeatherNow { tempF: number; feelsF: number; condition: string; precipPct: number; windMph: number; }
export interface WeatherDay { dateIso: string; hiF: number; loF: number; condition: string; precipPct: number; }
export interface EmailSummary { id: string; from: string; subject: string; snippet: string; ts: number; unread: boolean; }
export interface EmailDetailSanitized {
  id: string; from: string; to: string[]; subject: string;
  ts: number; safeHtml: string; plainText: string; remoteImagesBlocked: number;
}

/**
 * One concrete occurrence of a (possibly recurring) event, expanded by
 * eventsRepo (C6), shaped per E1. dateIso/notes/rrule are Apollo-internal
 * extras the calendar tools need (exdate key, card text, re-arm).
 */
export interface OccurrenceDTO {
  eventId: string; occStartTs: number; occEndTs: number;
  title: string; allDay: boolean; tz: string; isRecurring: boolean; location: string | null;
  notes: string | null;
  dateIso: string;        // local calendar date of this occurrence (exdate key)
  rrule: string | null;   // the parent event's rule, null for one-offs
  calendarId: string;     // I1: calendar membership (renderer derives color)
}

export const occurrenceDTOSchema: z.ZodType<OccurrenceDTO> = z.object({
  eventId: z.string(), occStartTs: z.number(), occEndTs: z.number(),
  title: z.string(), allDay: z.boolean(), tz: z.string(), isRecurring: z.boolean(),
  location: z.string().nullable(), notes: z.string().nullable(),
  dateIso: z.string(), rrule: z.string().nullable(), calendarId: z.string(),
});

/** E1: notes list row for the Workspace. */
export interface NoteListItem {
  id: string; title: string; snippet: string; updatedAt: number; pinned: boolean;
}

export const noteListItemSchema: z.ZodType<NoteListItem> = z.object({
  id: z.string(), title: z.string(), snippet: z.string(), updatedAt: z.number(), pinned: z.boolean(),
});

export type CardPayload =
  | { kind: 'text'; body: string }
  | { kind: 'event'; event: EventDTO }
  | { kind: 'eventList'; title: string; events: EventDTO[] }
  | { kind: 'weather'; place: string; now: WeatherNow; days: WeatherDay[] }
  | { kind: 'newsList'; items: { title: string; source: string; url: string; summary: string }[] }
  | { kind: 'timer'; id: string; label: string | null; endsAt: number }
  | { kind: 'emailList'; items: EmailSummary[] }
  | { kind: 'emailDetail'; email: EmailDetailSanitized }
  | { kind: 'draft'; to: string[]; subject: string; body: string }
  | { kind: 'confirm'; confirmationId: string; action: ConfirmAction; expiresAt: number }
  | { kind: 'batchConfirm'; confirmationId: string; actions: ConfirmAction[]; expiresAt: number }
  | { kind: 'brief'; sections: CardPayload[] }
  | { kind: 'nudge'; suggestion: SuggestionDTO }
  | { kind: 'nudgeGroup'; suggestions: SuggestionDTO[] }
  | { kind: 'recallList'; items: RecallItem[] };

export interface RecallItem {
  chunkId: string;
  kind: 'note' | 'message' | 'fact';
  refId: string;
  title: string;
  snippet: string;
  ts: number;
}

// ---- zod schemas (each DTO JSON-safe with a schema, C3) ----

export const eventDTOSchema: z.ZodType<EventDTO> = z.object({
  id: z.string(), title: z.string(), startTs: z.number(), endTs: z.number().nullable(),
  tz: z.string(), allDay: z.boolean(), rrule: z.string().nullable(),
  location: z.string().nullable(), notes: z.string().nullable(),
  calendarId: z.string(), color: z.string(),
});

export const weatherNowSchema: z.ZodType<WeatherNow> = z.object({
  tempF: z.number(), feelsF: z.number(), condition: z.string(), precipPct: z.number(), windMph: z.number(),
});

export const weatherDaySchema: z.ZodType<WeatherDay> = z.object({
  dateIso: z.string(), hiF: z.number(), loF: z.number(), condition: z.string(), precipPct: z.number(),
});

export const emailSummarySchema: z.ZodType<EmailSummary> = z.object({
  id: z.string(), from: z.string(), subject: z.string(), snippet: z.string(), ts: z.number(), unread: z.boolean(),
});

export const emailDetailSchema: z.ZodType<EmailDetailSanitized> = z.object({
  id: z.string(), from: z.string(), to: z.array(z.string()), subject: z.string(),
  ts: z.number(), safeHtml: z.string(), plainText: z.string(), remoteImagesBlocked: z.number(),
});

export const confirmActionSchema: z.ZodType<ConfirmAction> = z.object({
  toolName: z.string(),
  summary: z.string(),
  args: z.record(z.unknown()),
  taintFlags: z.array(z.string()),
});

const newsItemSchema = z.object({
  title: z.string(), source: z.string(), url: z.string(), summary: z.string(),
});

export const recallItemSchema: z.ZodType<RecallItem> = z.object({
  chunkId: z.string(),
  kind: z.enum(['note', 'message', 'fact']),
  refId: z.string(),
  title: z.string(),
  snippet: z.string(),
  ts: z.number(),
});

/** F1: schema for SuggestionDTO (type defined in agent.ts); the optional `card`
 *  references cardPayloadSchema via z.lazy to break the mutual recursion. */
export const suggestionDTOSchema: z.ZodType<SuggestionDTO> = z.lazy(() =>
  z.object({
    id: z.string(),
    ruleId: z.string(),
    urgency: z.enum(['low', 'normal', 'time-sensitive']),
    title: z.string(),
    body: z.string(),
    card: cardPayloadSchema.optional(),
    actions: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['primary', 'snooze', 'dismiss']) })),
    createdAt: z.number(),
  }),
) as unknown as z.ZodType<SuggestionDTO>;

export const cardPayloadSchema: z.ZodType<CardPayload> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), body: z.string() }),
    z.object({ kind: z.literal('event'), event: eventDTOSchema }),
    z.object({ kind: z.literal('eventList'), title: z.string(), events: z.array(eventDTOSchema) }),
    z.object({ kind: z.literal('weather'), place: z.string(), now: weatherNowSchema, days: z.array(weatherDaySchema) }),
    z.object({ kind: z.literal('newsList'), items: z.array(newsItemSchema) }),
    z.object({ kind: z.literal('timer'), id: z.string(), label: z.string().nullable(), endsAt: z.number() }),
    z.object({ kind: z.literal('emailList'), items: z.array(emailSummarySchema) }),
    z.object({ kind: z.literal('emailDetail'), email: emailDetailSchema }),
    z.object({ kind: z.literal('draft'), to: z.array(z.string()), subject: z.string(), body: z.string() }),
    z.object({ kind: z.literal('confirm'), confirmationId: z.string(), action: confirmActionSchema, expiresAt: z.number() }),
    z.object({ kind: z.literal('batchConfirm'), confirmationId: z.string(), actions: z.array(confirmActionSchema), expiresAt: z.number() }),
    z.object({ kind: z.literal('brief'), sections: z.array(cardPayloadSchema) }),
    z.object({ kind: z.literal('nudge'), suggestion: suggestionDTOSchema }),
    z.object({ kind: z.literal('nudgeGroup'), suggestions: z.array(suggestionDTOSchema) }),
    z.object({ kind: z.literal('recallList'), items: z.array(recallItemSchema) }),
  ]) as unknown as z.ZodType<CardPayload>,
);
