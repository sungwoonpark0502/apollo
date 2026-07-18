import Anthropic from '@anthropic-ai/sdk';
import { type LlmRequestBody, type LlmSseEvent, type SearchResponse } from '@apollo/shared';

/**
 * L0.1 provider boundary. The server holds the provider keys; these adapters
 * are injected so the route suite runs with fakes and never makes a real call.
 * The LLM adapter normalizes the provider stream into the shared SSE contract.
 */
export interface LlmProvider {
  /** Streams normalized events; must end with exactly one `done` or `error`. */
  stream(req: LlmRequestBody, onEvent: (e: LlmSseEvent) => void, signal?: AbortSignal): Promise<void>;
}

export interface SttProvider {
  /** Mints a short-lived scoped credential; the server key never leaves here. */
  mintToken(): Promise<{ token: string; expiresIn: number }>;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResponse>;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Anthropic tool names must match ^[a-zA-Z0-9_-]{1,128}$, which excludes the
 * dot in Apollo's namespace.verb names. Same sanitization as the direct client
 * adapter, applied server-side, and reversed before the event reaches the
 * orchestrator so both transports emit identical tool names.
 */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function createAnthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    async stream(req, onEvent, signal) {
      const realNameOf = new Map<string, string>();
      for (const t of req.tools) realNameOf.set(sanitizeToolName(t.name), t.name);

      try {
        const stream = client.messages.stream(
          {
            model: req.model ?? DEFAULT_MODEL,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: req.messages as unknown as Anthropic.MessageParam[],
            tools: req.tools.map((t) => ({ ...t, name: sanitizeToolName(t.name) })) as unknown as Anthropic.Tool[],
          },
          { signal },
        );
        stream.on('text', (delta) => onEvent({ type: 'text', delta }));
        const final = await stream.finalMessage();
        for (const block of final.content) {
          if (block.type === 'tool_use') {
            onEvent({ type: 'tool_use', id: block.id, name: realNameOf.get(block.name) ?? block.name, input: block.input });
          }
        }
        onEvent({
          type: 'done',
          stopReason: final.stop_reason === 'tool_use' ? 'tool_use' : final.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
          usage: { inputTokens: final.usage?.input_tokens ?? 0, outputTokens: final.usage?.output_tokens ?? 0 },
        });
      } catch (e) {
        const status = e instanceof Anthropic.APIError ? (e.status ?? 0) : 0;
        const code = status === 401 || status === 403 ? 'provider_auth' : status === 429 ? 'provider_rate_limited' : 'provider_error';
        // Never leak provider error bodies (they can echo request content).
        onEvent({ type: 'error', code, message: 'upstream provider error' });
      }
    },
  };
}

export function createDeepgramProvider(apiKey: string, projectId: string): SttProvider {
  return {
    async mintToken() {
      // Deepgram short-lived key: scoped to member, 60s TTL. The long-lived
      // server key is used only for this call and never returned.
      const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
        method: 'POST',
        headers: { authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'apollo-desktop ephemeral', scopes: ['usage:write'], time_to_live_in_seconds: 60 }),
      });
      if (!res.ok) throw new Error(`deepgram key mint failed: ${res.status}`);
      const data = (await res.json()) as { key: string };
      return { token: data.key, expiresIn: 60 };
    },
  };
}

export function createBraveProvider(apiKey: string): SearchProvider {
  return {
    async search(query) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
      const res = await fetch(url, { headers: { 'x-subscription-token': apiKey, accept: 'application/json' } });
      if (!res.ok) throw new Error(`brave search failed: ${res.status}`);
      const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      return {
        results: (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })),
      };
    },
  };
}
