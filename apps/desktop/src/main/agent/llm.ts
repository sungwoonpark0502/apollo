import { type AnthropicToolJson } from '../tools/registry';

/**
 * Thin LLM adapter boundary: the orchestrator talks to this interface; the
 * Anthropic adapter (0.7) and FakeLlm (C17, tests) both implement it.
 */
export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

export interface LlmStreamRequest {
  system: string;
  messages: LlmMessage[];
  tools: AnthropicToolJson[];
  maxTokens: number;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LlmTurnResult {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  text: string;
  toolUses: LlmToolUse[];
  usage?: { inputTokens: number; outputTokens: number }; // H4 usage metering
}

export class LlmAbortError extends Error {
  constructor() {
    super('llm stream aborted');
    this.name = 'LlmAbortError';
  }
}

export interface LlmClient {
  stream(req: LlmStreamRequest): Promise<LlmTurnResult>;
}
