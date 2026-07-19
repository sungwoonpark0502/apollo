import { type LlmRequestBody, type LlmSseEvent } from '@apollo/shared';
import { sanitizeToolName, type LlmProvider } from './providers';
import { createDataLineSplitter } from './providersOpenAi';

/**
 * Google Gemini adapter (generateContent streaming). Same contract as the
 * OpenAI adapter: pure, tested translation in both directions; thin fetch loop;
 * live path verified at deployment (HUMAN_TODO).
 *
 * Two Gemini quirks shape this file. Function calls carry no ids, so the
 * adapter synthesizes them (`gem_0`, `gem_1`, …) — and because tool RESULTS
 * must be sent back by function NAME, the request translator recovers the name
 * from the tool_use block earlier in the history that carries the same id.
 * And roles are user/model, with function responses riding in a user turn.
 */

/** Our blocks → Gemini request body. Exported for tests. */
export function toGeminiRequest(req: LlmRequestBody): Record<string, unknown> {
  // tool_use_id → sanitized function name, resolved from history (see above).
  const nameOfId = new Map<string, string>();
  for (const m of req.messages) {
    for (const b of m.content) {
      if (b.type === 'tool_use') nameOfId.set(b.id, sanitizeToolName(b.name));
    }
  }

  const contents: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    const parts: Array<Record<string, unknown>> = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: sanitizeToolName(b.name), args: b.input ?? {} } });
      else parts.push({ functionResponse: { name: nameOfId.get(b.tool_use_id) ?? 'unknown', response: { result: b.content } } });
    }
    if (parts.length > 0) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }

  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    generationConfig: { maxOutputTokens: req.maxTokens },
    ...(req.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: sanitizeToolName(t.name),
                description: t.description,
                parameters: t.input_schema,
              })),
            },
          ],
        }
      : {}),
  };
}

/** Streaming accumulator; emits synthesized ids and exactly one `done`. */
export function createGeminiTranslator(realNameOf: Map<string, string>) {
  const calls: Array<{ name: string; args: unknown }> = [];
  let finishReason: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  return {
    push(chunk: unknown): LlmSseEvent[] {
      const out: LlmSseEvent[] = [];
      const c = chunk as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: unknown } }> };
          finishReason?: string;
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const cand = c.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.text) out.push({ type: 'text', delta: part.text });
        if (part.functionCall) calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
      }
      if (cand?.finishReason) finishReason = cand.finishReason;
      if (c.usageMetadata) {
        usage = { inputTokens: c.usageMetadata.promptTokenCount ?? 0, outputTokens: c.usageMetadata.candidatesTokenCount ?? 0 };
      }
      return out;
    },

    /** Terminal: drains accumulated calls, so a double call cannot emit twice. */
    finish(): LlmSseEvent[] {
      const out: LlmSseEvent[] = [];
      const drained = calls.splice(0);
      drained.forEach((call, i) => {
        out.push({ type: 'tool_use', id: `gem_${i}`, name: realNameOf.get(call.name) ?? call.name, input: call.args });
      });
      out.push({
        type: 'done',
        // Any function call means the turn continues with tool results,
        // regardless of what finishReason Gemini attached.
        stopReason: drained.length > 0 ? 'tool_use' : finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
        ...(usage ? { usage } : {}),
      });
      return out;
    },
  };
}

export function createGeminiProvider(apiKey: string, fetchFn: typeof fetch = fetch): LlmProvider {
  return {
    async stream(req, onEvent, signal) {
      const realNameOf = new Map<string, string>();
      for (const t of req.tools) realNameOf.set(sanitizeToolName(t.name), t.name);
      try {
        const model = req.model ?? 'gemini-2.5-flash';
        const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          // Key in a header, never in the URL: URLs land in access logs.
          headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(toGeminiRequest(req)),
          ...(signal ? { signal } : {}),
        });
        if (!res.ok || !res.body) {
          const code = res.status === 401 || res.status === 403 ? 'provider_auth' : res.status === 429 ? 'provider_rate_limited' : 'provider_error';
          onEvent({ type: 'error', code, message: 'upstream provider error' });
          return;
        }
        const translator = createGeminiTranslator(realNameOf);
        const splitter = createDataLineSplitter();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const data of splitter.push(decoder.decode(value, { stream: true }))) {
            try {
              for (const e of translator.push(JSON.parse(data))) onEvent(e);
            } catch {
              /* skip an unparseable frame */
            }
          }
        }
        for (const e of translator.finish()) onEvent(e);
      } catch {
        onEvent({ type: 'error', code: 'provider_error', message: 'upstream provider error' });
      }
    },
  };
}
