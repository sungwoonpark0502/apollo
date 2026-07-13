import { z } from 'zod';
import { type CardPayload, cardPayloadSchema, confirmActionSchema } from './cards';
import { type ErrorCode, errorCodeSchema } from './errors';

export type Tier = 1 | 2 | 3; // 1 read, 2 local write (undoable), 3 external effect (confirm)

export interface ToolCtx {
  now: () => Date; tz: string;
  convId: string; turnId: string;
  taint: boolean;                    // untrusted content entered this turn
  userUtterances: string[];          // all user texts in this conversation (for taint value check)
  source: 'voice' | 'text';
}

export interface ToolResult {
  llmText: string;                   // what the model sees; plain text, no markdown
  card?: CardPayload;                // what the user sees
  untrusted?: boolean;               // result contains external content
  undoToken?: string;                // undo registered for this action
}

export interface ToolDef<P extends z.ZodType = z.ZodType> {
  name: string;                      // dot-namespaced, e.g. "calendar.create"
  description: string;               // written for the LLM: when to use, arg conventions
  tier: Tier;
  params: P;
  networked?: boolean;               // 30s timeout instead of 15s
  execute(args: z.infer<P>, ctx: ToolCtx): Promise<ToolResult>;
}

export interface ConfirmAction {
  toolName: string; summary: string; // human sentence: 'Send email to jane@x.com: "Re: lease"'
  args: Record<string, unknown>;
  taintFlags: string[];              // e.g. ["value_not_user_stated:recipient"]
}

export type AgentEvent =
  | { type: 'turnStart'; turnId: string }
  | { type: 'token'; text: string }
  | { type: 'toolStart'; tool: string }
  | { type: 'toolResult'; tool: string; ok: boolean }
  | { type: 'card'; card: CardPayload }
  | { type: 'confirmRequest'; confirmationId: string; action: ConfirmAction; expiresAt: number }
  | { type: 'cancelWindow'; confirmationId: string; ms: number }   // email.send 5s window
  | { type: 'done'; turnId: string }
  | { type: 'error'; code: ErrorCode; userMessage: string };

export const agentEventSchema: z.ZodType<AgentEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turnStart'), turnId: z.string() }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('toolStart'), tool: z.string() }),
  z.object({ type: z.literal('toolResult'), tool: z.string(), ok: z.boolean() }),
  z.object({ type: z.literal('card'), card: cardPayloadSchema }),
  z.object({ type: z.literal('confirmRequest'), confirmationId: z.string(), action: confirmActionSchema, expiresAt: z.number() }),
  z.object({ type: z.literal('cancelWindow'), confirmationId: z.string(), ms: z.number() }),
  z.object({ type: z.literal('done'), turnId: z.string() }),
  z.object({ type: z.literal('error'), code: errorCodeSchema, userMessage: z.string() }),
]) as unknown as z.ZodType<AgentEvent>;

export const messageSourceSchema = z.enum(['voice', 'text']);
export type MessageSource = z.infer<typeof messageSourceSchema>;

// ---- F1 Proactive Engine contracts ----

export type Urgency = 'low' | 'normal' | 'time-sensitive';
export const urgencySchema = z.enum(['low', 'normal', 'time-sensitive']);

export interface SuggestionAction {
  id: string;
  label: string;
  kind: 'primary' | 'snooze' | 'dismiss';
}
export const suggestionActionSchema: z.ZodType<SuggestionAction> = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['primary', 'snooze', 'dismiss']),
});

export interface SuggestionDTO {
  id: string;
  ruleId: string;
  urgency: Urgency;
  title: string;
  body: string;
  card?: CardPayload; // optional rich payload (e.g. eventList)
  actions: SuggestionAction[]; // always includes a dismiss
  createdAt: number;
}
// suggestionDTOSchema lives in cards.ts alongside cardPayloadSchema (SuggestionDTO.card
// is a CardPayload); keeping it there avoids a circular schema-init between the files.
