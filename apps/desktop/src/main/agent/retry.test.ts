import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, ToolDef } from '@apollo/shared';
import { openDb } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos/index';
import { createRegistry } from '../tools/registry';
import { createOrchestrator, type Orchestrator } from './orchestrator';
import { FakeLlm, type FakeStep } from './llmFake';
import { buildSystemPrompt } from './systemPrompt';

/** A tool that fails on its first call and succeeds afterward (transient network). */
function flaky(): { tool: ToolDef; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  let attempts = 0;
  const tool: ToolDef<z.ZodType<{ place?: string }>> = {
    name: 'weather.now',
    tier: 1,
    networked: true,
    description: 'flaky weather',
    params: z.object({ place: z.string().optional() }),
    async execute(a) {
      calls.push(a);
      attempts += 1;
      return attempts === 1 ? { llmText: 'ERROR OFFLINE network failed' } : { llmText: 'Weather: 72 and clear.' };
    },
  };
  return { tool, calls };
}

function setup(script: FakeStep[]): { orch: Orchestrator; calls: Array<Record<string, unknown>>; events: AgentEvent[] } {
  const db = openDb(':memory:');
  migrate(db);
  const repos = createRepos(db);
  const events: AgentEvent[] = [];
  const { tool, calls } = flaky();
  const registry = createRegistry([tool]);
  const orch = createOrchestrator({
    registry,
    repos,
    llm: new FakeLlm(script),
    systemPrompt: () => buildSystemPrompt('James'),
    emit: (e) => events.push(e),
    tz: () => 'UTC',
    historyEnabled: () => true,
  });
  return { orch, calls, events };
}

async function say(orch: Orchestrator, text: string, convId = 'c1'): Promise<void> {
  await orch.handleUserMessage({ text, source: 'text', convId }).completion;
}

describe('I5 retry-with-memory', () => {
  it('"try again" re-invokes the exact failed tool call, then clears on success', async () => {
    const { orch, calls } = setup([
      { toolUses: [{ name: 'weather.now', input: { place: 'Columbus' } }] }, // fails
      { text: "I couldn't reach the weather service. Want me to try again?" },
      { text: "It's 72 and clear." }, // reply after the successful retry
      { text: 'Nothing to retry now.' }, // a 3rd "try again" with no stored failure
    ]);

    await say(orch, "what's the weather in Columbus");
    expect(calls).toHaveLength(1); // failed once

    await say(orch, 'try again');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]); // exact same args re-invoked, no re-reasoning

    // cleared on success: a further "try again" does not re-invoke the tool
    await say(orch, 'try again');
    expect(calls).toHaveLength(2);
  });

  it('an affirmative ("yes") also retries a failed call', async () => {
    const { orch, calls } = setup([
      { toolUses: [{ name: 'weather.now', input: { place: 'Columbus' } }] },
      { text: 'That failed — retry?' },
      { text: 'Got it now.' },
    ]);
    await say(orch, 'weather please');
    await say(orch, 'yes');
    expect(calls).toHaveLength(2);
  });

  it('does not retry across a different conversation (new topic)', async () => {
    const { orch, calls } = setup([
      { toolUses: [{ name: 'weather.now', input: { place: 'Columbus' } }] },
      { text: 'failed' },
      { text: 'fresh conversation reply' },
    ]);
    await say(orch, 'weather', 'convA');
    await say(orch, 'try again', 'convB'); // different conversation → no stored failure
    expect(calls).toHaveLength(1);
  });
});
