import { newId } from '@apollo/shared';
import { LlmAbortError, type LlmClient, type LlmStreamRequest, type LlmTurnResult, type LlmToolUse } from './llm';

/** One scripted assistant turn; a function form can inspect the request. */
export type FakeStep =
  | { text?: string; toolUses?: Array<Pick<LlmToolUse, 'name' | 'input'>>; delayMs?: number }
  | ((req: LlmStreamRequest) => { text?: string; toolUses?: Array<Pick<LlmToolUse, 'name' | 'input'>>; delayMs?: number });

/**
 * FakeLLM (C17): executes scripted tool-call sequences so the orchestrator,
 * confirmations, and chunker are CI-testable with zero keys.
 */
export class FakeLlm implements LlmClient {
  public readonly requests: LlmStreamRequest[] = [];

  constructor(private readonly script: FakeStep[]) {}

  get remainingSteps(): number {
    return this.script.length;
  }

  async stream(req: LlmStreamRequest): Promise<LlmTurnResult> {
    this.requests.push(req);
    const raw = this.script.shift();
    const step = typeof raw === 'function' ? raw(req) : (raw ?? { text: '' });

    if (step.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, step.delayMs);
        req.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new LlmAbortError());
        });
      });
    }
    if (req.signal?.aborted) throw new LlmAbortError();

    const text = step.text ?? '';
    // stream words as separate deltas
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (req.signal?.aborted) throw new LlmAbortError();
      req.onText(chunk);
    }
    const toolUses = (step.toolUses ?? []).map((t) => ({ ...t, id: `tu_${newId()}` }));
    return { stopReason: toolUses.length ? 'tool_use' : 'end_turn', text, toolUses };
  }
}
