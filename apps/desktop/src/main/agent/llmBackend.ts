import { AppError, createSseParser, type LlmSseEvent } from '@apollo/shared';
import { LlmAbortError, type LlmClient, type LlmToolUse } from './llm';

/**
 * L0.2 managed-mode LLM transport. Implements the SAME LlmClient interface as
 * the direct Anthropic adapter, so the orchestrator, tools, and voice code are
 * unchanged — only the transport differs. Requests go to the Apollo backend,
 * which injects the provider key and streams the normalized SSE contract back.
 */
export interface BackendLlmDeps {
  baseUrl: string;
  /** Returns a valid session token, refreshing silently; null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** The user's provider/model pick, read live per turn so a mid-session
   *  switch applies to the NEXT turn without a restart. Omitted → anthropic. */
  choice?: () => { provider: 'anthropic' | 'openai' | 'google'; model: string };
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}

export function createBackendLlm(deps: BackendLlmDeps): LlmClient {
  const fetchFn = deps.fetchFn ?? fetch;
  return {
    async stream(req) {
      const token = await deps.getAccessToken();
      // L1 signed-out UX: a typed error the orchestrator maps to a sign-in
      // affordance, never a keys request.
      if (!token) throw new AppError('AUTH_REQUIRED', 'sign in to use the assistant');

      let res: Response;
      try {
        res = await fetchFn(`${deps.baseUrl}/v1/llm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            system: req.system,
            messages: req.messages,
            tools: req.tools,
            maxTokens: req.maxTokens,
            ...(deps.choice ? deps.choice() : {}),
          }),
          signal: req.signal,
        });
      } catch (e) {
        if (e instanceof Error && (e.name === 'AbortError' || req.signal?.aborted)) throw new LlmAbortError();
        throw new AppError('LLM_DOWN', 'apollo backend unreachable', e);
      }

      if (res.status === 401) throw new AppError('AUTH_REQUIRED', 'session expired');
      if (res.status === 429) {
        // Typed quota breach → friendly copy, not a raw provider error.
        const body = (await res.json().catch(() => ({}))) as { resetIso?: string };
        throw new AppError('QUOTA_EXCEEDED', body.resetIso ?? '');
      }
      if (!res.ok || !res.body) throw new AppError('LLM_DOWN', `apollo backend ${res.status}`);

      const parser = createSseParser();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const toolUses: LlmToolUse[] = [];
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let streamError: LlmSseEvent | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.push(decoder.decode(value, { stream: true }))) {
            switch (event.type) {
              case 'text':
                text += event.delta;
                req.onText(event.delta);
                break;
              case 'tool_use':
                toolUses.push({ id: event.id, name: event.name, input: event.input });
                break;
              case 'done':
                stopReason = event.stopReason;
                usage = event.usage;
                break;
              case 'error':
                streamError = event;
                break;
            }
          }
        }
      } catch (e) {
        if (req.signal?.aborted) throw new LlmAbortError();
        throw new AppError('LLM_DOWN', 'apollo backend stream failed', e);
      } finally {
        reader.releaseLock();
      }

      if (streamError) {
        deps.log?.(`backend llm error: ${streamError.code}`);
        throw new AppError(streamError.code === 'provider_rate_limited' ? 'RATE_LIMITED' : 'LLM_DOWN', 'upstream provider error');
      }

      return { stopReason, text, toolUses, ...(usage ? { usage } : {}) };
    },
  };
}
