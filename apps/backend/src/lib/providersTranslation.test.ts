import { describe, expect, it } from 'vitest';
import { type LlmRequestBody, type LlmSseEvent } from '@apollo/shared';
import { sanitizeToolName } from './providers';
import { createDataLineSplitter, createOpenAiTranslator, toOpenAiRequest } from './providersOpenAi';
import { createGeminiTranslator, toGeminiRequest } from './providersGoogle';

/**
 * Multi-provider translation. The property that matters: the orchestrator sees
 * the SAME normalized event sequence whatever provider produced it, including
 * dotted tool names surviving the round trip through each provider's stricter
 * naming rules.
 */

/** A canonical mid-conversation request: a tool has run, its result is going back. */
const REQ: LlmRequestBody = {
  system: 'You are Apollo.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'set a timer for 5 minutes' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Setting it now.' },
        { type: 'tool_use', id: 'call_1', name: 'timer.start', input: { minutes: 5 } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true}' }] },
  ],
  tools: [{ name: 'timer.start', description: 'Start a timer', input_schema: { type: 'object' } }],
  maxTokens: 1024,
  model: 'test-model',
};

describe('OpenAI request translation', () => {
  const body = toOpenAiRequest(REQ) as {
    messages: Array<Record<string, unknown>>;
    tools: Array<{ function: { name: string; parameters: unknown } }>;
  };

  it('puts the system prompt first and keeps message order', () => {
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Apollo.' });
    expect(body.messages.map((m) => m['role'])).toEqual(['system', 'user', 'assistant', 'tool']);
  });

  it('sanitizes dotted tool names in both tools and calls', () => {
    // OpenAI rejects dots in function names, same as Anthropic.
    expect(body.tools[0]!.function.name).toBe('timer_start');
    const asst = body.messages[2] as { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
    expect(asst.tool_calls[0]!.function.name).toBe('timer_start');
    expect(asst.tool_calls[0]!.id).toBe('call_1');
    expect(JSON.parse(asst.tool_calls[0]!.function.arguments)).toEqual({ minutes: 5 });
  });

  it('turns a tool_result into a role:tool message bound to its call id', () => {
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' });
  });

  it('sends null content, not "", for a tool-only assistant turn', () => {
    const toolOnly: LlmRequestBody = {
      ...REQ,
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'a.b', input: {} }] }],
    };
    const m = (toOpenAiRequest(toolOnly) as { messages: Array<{ content: unknown }> }).messages[1]!;
    expect(m.content).toBeNull();
  });

  it('asks for streamed usage', () => {
    expect(toOpenAiRequest(REQ)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
});

describe('OpenAI stream translation', () => {
  function run(chunks: unknown[], names = new Map([['timer_start', 'timer.start']])): LlmSseEvent[] {
    const t = createOpenAiTranslator(names);
    const out: LlmSseEvent[] = [];
    for (const c of chunks) out.push(...t.push(c));
    out.push(...t.finish());
    return out;
  }

  it('passes text deltas through as they arrive', () => {
    const events = run([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('reassembles a tool call fragmented across chunks and restores the dotted name', () => {
    const events = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'timer_start', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"minu' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tes":5}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'call_9', name: 'timer.start', input: { minutes: 5 } },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });

  it('keeps parallel tool calls separate and ordered by index', () => {
    const events = run([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: 'b', function: { name: 'timer_start', arguments: '{"minutes":2}' } },
                { index: 0, id: 'a', function: { name: 'timer_start', arguments: '{"minutes":1}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(events.filter((e) => e.type === 'tool_use').map((e) => (e.type === 'tool_use' ? e.id : ''))).toEqual(['a', 'b']);
  });

  it('maps length to max_tokens and carries usage from the final chunk', () => {
    const events = run([
      { choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens', usage: { inputTokens: 10, outputTokens: 4 } });
  });

  it('malformed argument JSON degrades to {} instead of crashing the turn', () => {
    const events = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'timer_start', arguments: '{oops' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(events[0]).toEqual({ type: 'tool_use', id: 'c', name: 'timer.start', input: {} });
  });
});

describe('Gemini request translation', () => {
  const body = toGeminiRequest(REQ) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
  };

  it('moves the system prompt to systemInstruction and uses user/model roles', () => {
    expect(body.systemInstruction.parts[0]!.text).toBe('You are Apollo.');
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('recovers the function NAME for a tool_result from the id in history', () => {
    // Gemini keys function responses by name, but our tool_result only carries
    // the id — the translator must join them through the earlier tool_use.
    const response = body.contents[2]!.parts[0] as { functionResponse: { name: string; response: { result: string } } };
    expect(response.functionResponse.name).toBe('timer_start');
    expect(response.functionResponse.response.result).toBe('{"ok":true}');
  });

  it('declares tools with sanitized names', () => {
    expect(body.tools[0]!.functionDeclarations[0]!.name).toBe('timer_start');
  });
});

describe('Gemini stream translation', () => {
  function run(chunks: unknown[], names = new Map([['timer_start', 'timer.start']])): LlmSseEvent[] {
    const t = createGeminiTranslator(names);
    const out: LlmSseEvent[] = [];
    for (const c of chunks) out.push(...t.push(c));
    out.push(...t.finish());
    return out;
  }

  it('synthesizes stable ids for calls, since Gemini provides none', () => {
    const events = run([
      { candidates: [{ content: { parts: [{ functionCall: { name: 'timer_start', args: { minutes: 5 } } }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: 'timer_start', args: { minutes: 2 } } }] }, finishReason: 'STOP' }] },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'gem_0', name: 'timer.start', input: { minutes: 5 } },
      { type: 'tool_use', id: 'gem_1', name: 'timer.start', input: { minutes: 2 } },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });

  it('a function call forces stopReason tool_use even when Gemini says STOP', () => {
    const events = run([
      { candidates: [{ content: { parts: [{ functionCall: { name: 'timer_start' } }] }, finishReason: 'STOP' }] },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('streams text and maps MAX_TOKENS with usage', () => {
    const events = run([
      { candidates: [{ content: { parts: [{ text: 'Hi ' }, { text: 'there' }] } }] },
      { candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } },
    ]);
    expect(events).toEqual([
      { type: 'text', delta: 'Hi ' },
      { type: 'text', delta: 'there' },
      { type: 'done', stopReason: 'max_tokens', usage: { inputTokens: 7, outputTokens: 3 } },
    ]);
  });

  it('round-trips a synthesized id back into a named functionResponse', () => {
    // The id the translator invents must be usable as tool_use_id on the next
    // request — end to end, this is what makes Gemini tool calling work at all.
    const followUp: LlmRequestBody = {
      ...REQ,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'gem_0', name: 'timer.start', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'gem_0', content: 'done' }] },
      ],
    };
    const body = toGeminiRequest(followUp) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    const fr = body.contents[1]!.parts[0] as { functionResponse: { name: string } };
    expect(fr.functionResponse.name).toBe('timer_start');
  });
});

describe('provider SSE line splitter', () => {
  it('handles data: frames split across arbitrary chunk boundaries', () => {
    const s = createDataLineSplitter();
    const out = [...s.push('data: {"a"'), ...s.push(':1}\nda'), ...s.push('ta: [DONE]\n')];
    expect(out).toEqual(['{"a":1}', '[DONE]']);
  });

  it('ignores comments, blank lines, and event fields', () => {
    const s = createDataLineSplitter();
    expect(s.push(': keepalive\n\nevent: ping\ndata: {"x":2}\n')).toEqual(['{"x":2}']);
  });
});

describe('cross-provider parity', () => {
  it('every provider surfaces the identical normalized tool sequence for the same turn', () => {
    // The point of the whole layer: one orchestrator, N providers.
    const names = new Map([[sanitizeToolName('calendar.create'), 'calendar.create']]);

    const openai = createOpenAiTranslator(names);
    openai.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'calendar_create', arguments: '{"title":"Dentist"}' } }] } }] });
    openai.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });

    const gemini = createGeminiTranslator(names);
    gemini.push({ candidates: [{ content: { parts: [{ functionCall: { name: 'calendar_create', args: { title: 'Dentist' } } }] } }] });

    const strip = (events: LlmSseEvent[]) =>
      events.filter((e) => e.type === 'tool_use').map((e) => (e.type === 'tool_use' ? { name: e.name, input: e.input } : null));

    expect(strip(openai.finish())).toEqual(strip(gemini.finish()));
    expect(strip(gemini.finish())).toEqual([]); // finish() is terminal, not repeatable
  });
});
