import { type LlmRequestBody, type LlmSseEvent } from '@apollo/shared';
import { sanitizeToolName, type LlmProvider } from './providers';

/**
 * OpenAI chat-completions adapter. Translates Apollo's internal message shape
 * (Anthropic-style content blocks) to OpenAI's and normalizes the stream back
 * to the shared SSE contract, so the orchestrator cannot tell providers apart.
 *
 * fetch-based, no SDK: the two translation directions are exported as pure
 * functions and unit-tested; the network loop stays thin. Like the Deepgram
 * adapter, the live path is exercised in deployment (HUMAN_TODO), never CI.
 */

/** Our blocks → OpenAI messages. Exported for tests. */
export function toOpenAiRequest(req: LlmRequestBody): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: req.system }];

  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
      const toolCalls = m.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => b.type === 'tool_use' ? {
          id: b.id,
          type: 'function',
          function: { name: sanitizeToolName(b.name), arguments: JSON.stringify(b.input ?? {}) },
        } : null);
      messages.push({
        role: 'assistant',
        // OpenAI rejects content:"" alongside tool_calls; null is the documented form.
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // A user turn may interleave plain text and tool results; tool results
      // become their own role:'tool' messages, ordered after the text.
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
      if (text.length > 0) messages.push({ role: 'user', content: text });
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        }
      }
    }
  }

  return {
    model: req.model,
    max_completion_tokens: req.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...(req.tools.length > 0
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: sanitizeToolName(t.name), description: t.description, parameters: t.input_schema },
          })),
        }
      : {}),
  };
}

/**
 * Streaming accumulator. Text deltas pass straight through; tool calls arrive
 * as argument fragments spread over many chunks and are only emitted at
 * finish(), fully assembled, followed by exactly one `done`.
 */
export function createOpenAiTranslator(realNameOf: Map<string, string>) {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  return {
    push(chunk: unknown): LlmSseEvent[] {
      const out: LlmSseEvent[] = [];
      const c = chunk as {
        choices?: Array<{
          delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const choice = c.choices?.[0];
      if (choice?.delta?.content) out.push({ type: 'text', delta: choice.delta.content });
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (c.usage) usage = { inputTokens: c.usage.prompt_tokens ?? 0, outputTokens: c.usage.completion_tokens ?? 0 };
      return out;
    },

    /** Terminal: drains accumulated calls, so a double call cannot emit twice. */
    finish(): LlmSseEvent[] {
      const out: LlmSseEvent[] = [];
      const drained = [...calls.entries()].sort(([a], [b]) => a - b);
      calls.clear();
      for (const [, call] of drained) {
        let input: unknown = {};
        try {
          input = call.args ? JSON.parse(call.args) : {};
        } catch {
          // A malformed fragment stream yields {} rather than a crashed turn;
          // the tool layer will reject the bad input with a typed error.
        }
        out.push({ type: 'tool_use', id: call.id, name: realNameOf.get(call.name) ?? call.name, input });
      }
      out.push({
        type: 'done',
        stopReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'length' ? 'max_tokens' : 'end_turn',
        ...(usage ? { usage } : {}),
      });
      return out;
    },
  };
}

/**
 * Incremental `data:` line splitter for provider SSE (OpenAI and Gemini both
 * use it). Distinct from shared/createSseParser, which parses Apollo's own
 * event-typed wire format.
 */
export function createDataLineSplitter() {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) out.push(line.slice(5).trim());
      }
      return out;
    },
  };
}

export function createOpenAiProvider(apiKey: string, fetchFn: typeof fetch = fetch): LlmProvider {
  return {
    async stream(req, onEvent, signal) {
      const realNameOf = new Map<string, string>();
      for (const t of req.tools) realNameOf.set(sanitizeToolName(t.name), t.name);
      try {
        const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(toOpenAiRequest(req)),
          ...(signal ? { signal } : {}),
        });
        if (!res.ok || !res.body) {
          const code = res.status === 401 || res.status === 403 ? 'provider_auth' : res.status === 429 ? 'provider_rate_limited' : 'provider_error';
          onEvent({ type: 'error', code, message: 'upstream provider error' });
          return;
        }
        const translator = createOpenAiTranslator(realNameOf);
        const splitter = createDataLineSplitter();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const data of splitter.push(decoder.decode(value, { stream: true }))) {
            if (data === '[DONE]') continue;
            try {
              for (const e of translator.push(JSON.parse(data))) onEvent(e);
            } catch {
              /* skip an unparseable frame; the terminal done still fires */
            }
          }
        }
        for (const e of translator.finish()) onEvent(e);
      } catch {
        // Never leak provider error bodies (they can echo request content).
        onEvent({ type: 'error', code: 'provider_error', message: 'upstream provider error' });
      }
    },
  };
}
