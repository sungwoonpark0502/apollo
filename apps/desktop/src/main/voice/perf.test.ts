import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos/index';
import { createRegistry } from '../tools/registry';
import { createTimerTools } from '../tools/timer';
import { createNoteTools } from '../tools/note';
import { createOrchestrator } from '../agent/orchestrator';
import { buildSystemPrompt } from '../agent/systemPrompt';
import { FakeLlm, type FakeStep } from '../agent/llmFake';
import { createTtsPipeline } from './tts/pipeline';
import { FakeTts } from './tts/fake';
import { createChunker } from './tts/chunker';
import type { AgentEvent } from '@apollo/shared';

/**
 * Perf harness (C21.4): replay 20 FakeSTT-driven turns end to end through the
 * real orchestrator + chunker + FakeTTS, and assert:
 *  - pipeline overhead (everything except provider time) p95 < 250ms
 *  - chunker first-flush < 50ms after the first sentence completes
 * Fakes inject no provider latency, so per-turn wall time is pure overhead.
 */

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

const UTTERANCES = [
  'set a timer for 5 minutes',
  'take a note that the garage code is 4417',
  'set a timer for 10 minutes labeled pasta',
  'note buy oat milk',
  'start a timer for 90 seconds',
];

function scriptFor(i: number): FakeStep[] {
  // Alternate: some turns call a tool then summarize, some are pure text.
  if (i % 2 === 0) {
    return [
      { toolUses: [{ name: 'timer.start', input: { seconds: 300 } }] },
      { text: 'Your timer is set for five minutes. It will ring shortly.' },
    ];
  }
  return [{ text: 'Done, I saved that note for you. Anything else you need right now?' }];
}

describe('C21.4 perf harness', () => {
  it('20 end-to-end turns: pipeline overhead p95 < 250ms', async () => {
    const db: Db = openDb(':memory:');
    migrate(db);
    const repos = createRepos(db);
    const registry = createRegistry([
      ...createTimerTools({ timers: repos.timers, undo: repos.undo }),
      ...createNoteTools({ notes: repos.notes, undo: repos.undo }),
    ]);

    const overheads: number[] = [];

    for (let turn = 0; turn < 20; turn++) {
      const events: AgentEvent[] = [];
      const fakeTts = new FakeTts();
      const pipeline = createTtsPipeline({
        adapter: fakeTts,
        pushAudio: () => undefined,
        pushStop: () => undefined,
        onFirstChunk: () => undefined,
      });
      const llm = new FakeLlm(scriptFor(turn));
      const orch = createOrchestrator({
        registry,
        repos,
        llm,
        systemPrompt: () => buildSystemPrompt('James'),
        emit: (e) => {
          events.push(e);
          if (e.type === 'token') pipeline.feedToken(e.text);
        },
        tz: () => 'America/Los_Angeles',
        historyEnabled: () => false,
      });

      const t0 = performance.now();
      pipeline.beginTurn();
      await orch.handleUserMessage({ text: UTTERANCES[turn % UTTERANCES.length] as string, source: 'voice', convId: `perf-${turn}` }).completion;
      pipeline.endTurn();
      const dt = performance.now() - t0;
      overheads.push(dt);

      expect(events.some((e) => e.type === 'done')).toBe(true);
    }

    const p = p95(overheads);
    // eslint-disable-next-line no-console
    console.log(`perf: overhead p95=${p.toFixed(1)}ms over ${overheads.length} turns`);
    expect(p).toBeLessThan(250);
  });

  it('chunker first-flush < 50ms after the first sentence completes', () => {
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      let flushedAt = 0;
      const start = performance.now();
      const c = createChunker(() => {
        if (flushedAt === 0) flushedAt = performance.now();
      });
      // stream tokens; the sentence completes on the period+space
      for (const tok of ['Your ', 'timer ', 'is ', 'set ', 'for ', 'five ', 'minutes. ']) c.feed(tok);
      latencies.push(flushedAt - start);
    }
    expect(p95(latencies)).toBeLessThan(50);
  });
});
