import { z } from 'zod';

/**
 * L0.1 Apollo backend wire contract. Shared by apps/backend (producer) and the
 * desktop managed-mode adapters (consumer) so the SSE shape can be contract-
 * tested from both sides. The /v1/llm stream is normalized to exactly what the
 * orchestrator's LlmClient needs — text deltas, tool uses, a terminal result —
 * so the orchestrator, tools, and voice code stay unchanged between transports.
 */

// ---- POST /v1/llm ----

export const llmContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('tool_result'), tool_use_id: z.string(), content: z.string(), is_error: z.boolean().optional() }),
]);

export const llmRequestSchema = z.object({
  system: z.string(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(llmContentBlockSchema) })),
  // Tool JSON is passed through to the provider; validated as a shape, not a schema.
  tools: z.array(z.object({ name: z.string(), description: z.string(), input_schema: z.record(z.unknown()) })),
  maxTokens: z.number().int().min(1).max(8192),
  model: z.string().optional(), // server picks a default; clients may not choose arbitrary models
});
export type LlmRequestBody = z.infer<typeof llmRequestSchema>;

/** One SSE frame from /v1/llm. `event:` carries the type, `data:` this payload. */
export const llmSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal('done'),
    stopReason: z.enum(['end_turn', 'tool_use', 'max_tokens']),
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type LlmSseEvent = z.infer<typeof llmSseEventSchema>;

/** Serializes one event as an SSE frame (the exact bytes the backend writes). */
export function encodeSse(event: LlmSseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incremental SSE parser: feed chunks, get complete events. Tolerates frames
 * split across chunk boundaries (the normal case on a real socket).
 */
export function createSseParser(): { push: (chunk: string) => LlmSseEvent[] } {
  let buffer = '';
  return {
    push(chunk: string): LlmSseEvent[] {
      buffer += chunk;
      const out: LlmSseEvent[] = [];
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          try {
            const parsed = llmSseEventSchema.safeParse(JSON.parse(dataLine.slice(5).trim()));
            if (parsed.success) out.push(parsed.data);
          } catch {
            /* malformed frame: skip rather than kill the stream */
          }
        }
        idx = buffer.indexOf('\n\n');
      }
      return out;
    },
  };
}

// ---- POST /v1/stt ----

/** A short-lived, scoped STT credential. The server key never reaches the client. */
export const sttTokenSchema = z.object({
  token: z.string(),
  expiresIn: z.number().int(), // seconds
  provider: z.literal('deepgram'),
});
export type SttToken = z.infer<typeof sttTokenSchema>;

// ---- GET /v1/search ----

export const searchResponseSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// ---- GET /v1/me, GET /v1/entitlements ----

export const meSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), plan: z.string() }),
  usage: z.object({ used: z.number(), limit: z.number(), resetIso: z.string() }),
});
export type Me = z.infer<typeof meSchema>;

export const entitlementsSchema = z.object({
  plan: z.string(),
  features: z.object({ llm: z.boolean(), stt: z.boolean(), search: z.boolean() }),
  limits: z.object({ monthlyTurns: z.number(), maxTokensPerTurn: z.number() }),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

// ---- Auth ----

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(), // seconds until accessToken expiry
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), plan: z.string() }),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** L0.1: quota breach shape — a typed 429 the client renders as friendly copy. */
export const quotaErrorSchema = z.object({
  error: z.literal('quota_exceeded'),
  used: z.number(),
  limit: z.number(),
  resetIso: z.string(),
});
export type QuotaError = z.infer<typeof quotaErrorSchema>;
