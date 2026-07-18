import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { encodeSse, type AgentEvent, type LlmSseEvent, type ToolDef } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createRegistry } from '../tools/registry';
import { createTimerTools } from '../tools/timer';
import { createNoteTools } from '../tools/note';
import { createOrchestrator } from '../agent/orchestrator';
import { buildSystemPrompt } from '../agent/systemPrompt';
import { createBackendLlm } from '../agent/llmBackend';
import { type LlmClient, type LlmStreamRequest, type LlmTurnResult } from '../agent/llm';

/**
 * L7 integration: a managed-mode turn against a MOCK BACKEND (SSE proxied) must
 * produce the same orchestrator behavior as direct mode against a mock
 * provider. One shared scenario set is run through BOTH transports and the tool
 * sequences must be identical — this is what proves the adapter swap leaves the
 * orchestrator, tools, and voice code unchanged.
 */

interface Scenario {
  id: string;
  utterance: string;
  /** Scripted provider turns, replayed identically by both transports. */
  turns: Array<{ text?: string; toolUses?: Array<{ name: string; input: unknown }> }>;
  expectTools: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'timer',
    utterance: 'start a pasta timer for five minutes',
    turns: [{ toolUses: [{ name: 'timer.start', input: { durationSec: 300, label: 'pasta' } }] }, { text: 'Timer is running.' }],
    expectTools: ['timer.start'],
  },
  {
    id: 'note',
    utterance: 'note that the lease renews in March',
    turns: [{ toolUses: [{ name: 'note.save', input: { content: 'lease renews in March' } }] }, { text: 'Saved that note.' }],
    expectTools: ['note.save'],
  },
  {
    id: 'multi-tool',
    utterance: 'set a timer and note it',
    turns: [
      { toolUses: [{ name: 'timer.start', input: { durationSec: 60 } }] },
      { toolUses: [{ name: 'note.save', input: { content: 'timer started' } }] },
      { text: 'Done both.' },
    ],
    expectTools: ['timer.start', 'note.save'],
  },
  {
    id: 'plain-reply',
    utterance: 'how are you',
    turns: [{ text: 'Doing well, thanks.' }],
    expectTools: [],
  },
];

let db: Db;
let repos: Repos;

/** Direct transport: a mock provider implementing LlmClient (the BYOK shape). */
function directLlm(scenario: Scenario): LlmClient {
  const script = [...scenario.turns];
  return {
    async stream(req: LlmStreamRequest): Promise<LlmTurnResult> {
      const step = script.shift() ?? { text: '' };
      const text = step.text ?? '';
      for (const chunk of text.match(/\S+\s*/g) ?? []) req.onText(chunk);
      const toolUses = (step.toolUses ?? []).map((t, i) => ({ ...t, id: `tu_${scenario.id}_${i}` }));
      return { stopReason: toolUses.length ? 'tool_use' : 'end_turn', text, toolUses };
    },
  };
}

/**
 * Managed transport: the REAL createBackendLlm parsing a REAL SSE byte stream
 * from a mock backend that replays the same script.
 */
function managedLlm(scenario: Scenario): LlmClient {
  const script = [...scenario.turns];
  let turn = 0;
  const fetchFn = (async () => {
    const step = script.shift() ?? { text: '' };
    const events: LlmSseEvent[] = [];
    for (const chunk of (step.text ?? '').match(/\S+\s*/g) ?? []) events.push({ type: 'text', delta: chunk });
    for (const [i, t] of (step.toolUses ?? []).entries()) {
      events.push({ type: 'tool_use', id: `tu_${scenario.id}_${i}`, name: t.name, input: t.input });
    }
    events.push({
      type: 'done',
      stopReason: (step.toolUses ?? []).length ? 'tool_use' : 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    turn += 1;

    // Emit as real SSE bytes, split across chunk boundaries to exercise the parser.
    const wire = events.map(encodeSse).join('');
    const bytes = new TextEncoder().encode(wire);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const mid = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;

  const client = createBackendLlm({
    baseUrl: 'https://api.apollo.test',
    getAccessToken: async () => 'access-1',
    fetchFn,
  });
  return { stream: (req) => client.stream(req).then((r) => { void turn; return r; }) };
}

function runTurn(llm: LlmClient, utterance: string): { events: AgentEvent[]; done: Promise<void> } {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  const events: AgentEvent[] = [];
  const registry = createRegistry([
    ...createTimerTools({ timers: repos.timers, undo: repos.undo }),
    ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
  ]);
  const orch = createOrchestrator({
    registry,
    repos,
    llm,
    systemPrompt: () => buildSystemPrompt('James'),
    emit: (e) => events.push(e),
    tz: () => 'America/Los_Angeles',
    historyEnabled: () => true,
    confirmTtlMs: 120_000,
    cancelWindowMs: 5,
  });
  return { events, done: orch.handleUserMessage({ text: utterance, source: 'text', convId: 'c1' }).completion };
}

/** The observable behavior we compare: ordered tool calls, event types, reply text. */
function shape(events: AgentEvent[]): { tools: string[]; types: string[]; text: string } {
  return {
    tools: events.filter((e): e is Extract<AgentEvent, { type: 'toolStart' }> => e.type === 'toolStart').map((e) => e.tool),
    types: events.map((e) => e.type),
    text: events.filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token').map((e) => e.text).join(''),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('L7 transport parity: managed (mock backend SSE) vs direct (mock provider)', () => {
  for (const scenario of SCENARIOS) {
    it(`"${scenario.id}" produces an identical tool sequence on both transports`, async () => {
      const direct = runTurn(directLlm(scenario), scenario.utterance);
      await direct.done;
      const directShape = shape(direct.events);

      const managed = runTurn(managedLlm(scenario), scenario.utterance);
      await managed.done;
      const managedShape = shape(managed.events);

      expect(managedShape.tools).toEqual(scenario.expectTools); // the scenario's contract
      expect(managedShape).toEqual(directShape); // and both transports agree exactly
    });
  }

  it('the managed transport really parsed SSE (not a stubbed shortcut)', async () => {
    // Guards the test above from silently passing on a no-op transport.
    const scenario = SCENARIOS[0]!;
    const managed = runTurn(managedLlm(scenario), scenario.utterance);
    await managed.done;
    expect(shape(managed.events).types).toContain('card'); // the tool actually ran
    expect(repos.timers.listActive()).toHaveLength(1); // and hit the real repo
  });
});

describe('L1 managed-mode signed-out behavior', () => {
  it('a signed-out managed turn raises AUTH_REQUIRED, never a keys error', async () => {
    const llm = createBackendLlm({
      baseUrl: 'https://api.apollo.test',
      getAccessToken: async () => null, // signed out
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    const fake: ToolDef<z.ZodType<Record<string, never>>> = {
      name: 'noop',
      tier: 1,
      description: 'noop',
      params: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      async execute() {
        return { llmText: 'ok' };
      },
    };
    void fake;
    await expect(
      llm.stream({ system: 's', messages: [], tools: [], maxTokens: 100, onText: () => undefined }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('a 429 from the backend surfaces QUOTA_EXCEEDED with the reset time', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: 'quota_exceeded', used: 200, limit: 200, resetIso: '2026-08-01T00:00:00.000Z' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const llm = createBackendLlm({ baseUrl: 'https://api.apollo.test', getAccessToken: async () => 'a', fetchFn });
    await expect(
      llm.stream({ system: 's', messages: [], tools: [], maxTokens: 100, onText: () => undefined }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', message: '2026-08-01T00:00:00.000Z' });
  });

  it('an expired session surfaces AUTH_REQUIRED so the client can re-prompt', async () => {
    const fetchFn = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const llm = createBackendLlm({ baseUrl: 'https://api.apollo.test', getAccessToken: async () => 'stale', fetchFn });
    await expect(
      llm.stream({ system: 's', messages: [], tools: [], maxTokens: 100, onText: () => undefined }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
