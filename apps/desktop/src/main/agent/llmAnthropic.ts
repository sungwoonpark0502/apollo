import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '@apollo/shared';
import { LlmAbortError, type LlmClient, type LlmMessage, type LlmToolUse } from './llm';

export interface AnthropicLlmDeps {
  apiKey: () => string | null;
  model: () => string;
  /** Egress-checked fetch so even SDK traffic obeys C14.9. */
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}

function toSdkMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): Anthropic.ContentBlockParam => {
      switch (b.type) {
        case 'text':
          return { type: 'text', text: b.text };
        case 'tool_use':
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
        case 'tool_result':
          return { type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error };
      }
    }),
  }));
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.APIUserAbortError) return new LlmAbortError();
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    if (status === 401 || status === 403) return new AppError('KEY_INVALID', 'anthropic auth failed', e);
    if (status === 429) return new AppError('RATE_LIMITED', 'anthropic rate limited', e);
    if (status >= 500) return new AppError('LLM_DOWN', `anthropic ${status}`, e);
    return new AppError('LLM_DOWN', `anthropic ${status}`, e);
  }
  if (e instanceof Error && e.name === 'AbortError') return new LlmAbortError();
  return new AppError('LLM_DOWN', 'anthropic connection failed', e);
}

export function createAnthropicLlm(deps: AnthropicLlmDeps): LlmClient {
  return {
    async stream(req) {
      const apiKey = deps.apiKey();
      if (!apiKey) throw new AppError('KEY_MISSING', 'no anthropic key');
      const client = new Anthropic({
        apiKey,
        fetch: deps.fetchFn,
        maxRetries: 2,
      });
      try {
        const stream = client.messages.stream(
          {
            model: deps.model(),
            max_tokens: req.maxTokens,
            system: req.system,
            messages: toSdkMessages(req.messages),
            tools: req.tools as unknown as Anthropic.Tool[],
          },
          { signal: req.signal },
        );
        stream.on('text', (t) => req.onText(t));
        const final = await stream.finalMessage();

        const text = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const toolUses: LlmToolUse[] = final.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));

        return {
          stopReason: final.stop_reason === 'tool_use' ? 'tool_use' : final.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
          text,
          toolUses,
        };
      } catch (e) {
        deps.log?.(`anthropic stream error: ${e instanceof Error ? e.message : String(e)}`);
        throw mapError(e);
      }
    },
  };
}
