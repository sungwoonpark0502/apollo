import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, ToolDef } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createRegistry } from '../tools/registry';
import { createTimerTools } from '../tools/timer';
import { createOrchestrator, type Orchestrator } from './orchestrator';
import { createConversationManager, type ConversationManager } from './conversationManager';
import { FakeLlm, type FakeStep } from './llmFake';
import { buildSystemPrompt } from './systemPrompt';
import { buildHandlers, type HandlerDeps } from '../ipc/handlers/index';
import { type Handlers } from '../ipc/router';
import { createVoiceController, type VoiceController } from '../voice/voiceController';
import { FakeStt, type FakeSttFixture } from '../voice/sttFake';
import {
  applyAgentEvent,
  loadThread,
  syncPersisted,
  type PersistedMessage,
  type ThreadState,
} from '../../renderer/components/chat/threadModel';

/**
 * K5 shared-thread integration: voice and the Chat tab are ONE conversation.
 * A voice turn (FakeSTT → VoiceController → dispatch, wired exactly as in
 * main/index.ts) must appear in the open Chat thread — simulated here with the
 * real Chat reducer processing real agent events plus the real
 * conversations.get handler, exactly as ChatView does — and a typed follow-up
 * through the real chat.send handler continues the same conversation.
 */

const WEATHER_FIXTURE: FakeSttFixture = {
  steps: [
    { delayMs: 200, partial: "what's the" },
    { delayMs: 300, partial: "what's the weather like", final: true },
  ],
};

let db: Db;
let repos: Repos;
let events: AgentEvent[];
let sentEmails: Array<Record<string, unknown>>;
let completions: Array<Promise<void>>;

const fakeSend: ToolDef<z.ZodType<{ to: string[]; subject: string; body: string }>> = {
  name: 'email.send',
  tier: 3,
  networked: true,
  description: 'send an email (test double)',
  params: z.object({ to: z.array(z.string()), subject: z.string(), body: z.string() }),
  async execute(a) {
    sentEmails.push(a);
    return { llmText: `Sent email to ${a.to.join(', ')}.` };
  },
};

interface Rig {
  orch: Orchestrator;
  llm: FakeLlm;
  cm: ConversationManager;
  handlers: Handlers;
  vc: VoiceController;
  stt: FakeStt;
}

function rig(script: FakeStep[], opts: { llmDown?: boolean; fixtures?: FakeSttFixture[]; cancelWindowMs?: number } = {}): Rig {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
  events = [];
  sentEmails = [];
  completions = [];

  const registry = createRegistry([...createTimerTools({ timers: repos.timers, undo: repos.undo }), fakeSend]);
  const llm = new FakeLlm(script);
  const orch = createOrchestrator({
    registry,
    repos,
    llm: opts.llmDown ? { stream: async () => { throw new Error('no key'); } } : llm,
    systemPrompt: () => buildSystemPrompt('James'),
    emit: (e) => events.push(e),
    tz: () => 'America/Los_Angeles',
    historyEnabled: () => true,
    confirmTtlMs: 120_000,
    cancelWindowMs: opts.cancelWindowMs ?? 5,
  });
  const cm = createConversationManager();

  // Voice side: dispatch wired exactly as main/index.ts wires it (source
  // 'voice', convId from the shared conversation manager).
  const stt = new FakeStt(opts.fixtures ?? [WEATHER_FIXTURE]);
  const vc = createVoiceController({
    stt,
    workerSend: () => undefined,
    dispatch: (text) => {
      completions.push(orch.handleUserMessage({ text, source: 'voice', convId: cm.forTurn() }).completion);
    },
    pushState: () => undefined,
    pushPartial: () => undefined,
    playEarcon: () => undefined,
    stopTts: () => undefined,
    getFollowupWindowSec: () => 0,
  });

  // Chat side: the REAL IPC handlers (chat.send/stop, conversations.*), built
  // with the same deps shape main/index.ts uses.
  const settingsStub = { get: () => { throw new Error('unused'); }, set: () => { throw new Error('unused'); } };
  const handlers = buildHandlers({
    orchestrator: () => orch,
    repos,
    settings: settingsStub as unknown as HandlerDeps['settings'],
    secrets: { get: () => null, set: () => false, has: () => false, delete: () => undefined, info: () => [] } as unknown as HandlerDeps['secrets'],
    testKey: async () => ({ ok: false, message: 'stub' }),
    setMuted: () => undefined,
    adapterStates: () => ({ stt: 'fake', tts: 'fake', wake: 'fake', llm: 'fake', embedder: 'fake' }),
    logTail: () => [],
    egressHosts: () => [],
    wipeAllData: () => undefined,
    activeConvId: () => cm.forTurn(),
    currentConvId: () => cm.current(),
    setActiveConversation: (id) => cm.setActive(id),
    newConversation: () => cm.startNew(),
    log: () => undefined,
  });

  return { orch, llm, cm, handlers, vc, stt };
}

/**
 * A faithful simulation of the open Chat tab: loads the active conversation,
 * then processes each agent event through the real reducer, fetching persisted
 * rows via the real conversations.get handler whenever the reducer flags a
 * sync — the same loop ChatView runs.
 */
class TabSim {
  thread: ThreadState;
  private seen = 0;

  private constructor(private readonly r: Rig, thread: ThreadState) {
    this.thread = thread;
  }

  static async open(r: Rig): Promise<TabSim> {
    const { id } = (await r.handlers['conversations.active']({}, undefined)) as { id: string };
    const messages = ((await r.handlers['conversations.get']({ id }, undefined)) as { messages: PersistedMessage[] }).messages;
    return new TabSim(r, loadThread(id, messages));
  }

  async fetch(convId: string): Promise<PersistedMessage[]> {
    return ((await this.r.handlers['conversations.get']({ id: convId }, undefined)) as { messages: PersistedMessage[] }).messages;
  }

  /** Processes events that arrived since the last drain, like the live subscription. */
  async drain(): Promise<void> {
    while (this.seen < events.length) {
      const e = events[this.seen]!;
      this.seen += 1;
      let res = applyAgentEvent(this.thread, e, (t) => t);
      if (res.needsSwitch) {
        this.thread = loadThread(res.needsSwitch, await this.fetch(res.needsSwitch));
        res = applyAgentEvent(this.thread, e, (t) => t);
      }
      this.thread = res.state;
      if (res.needsSync && this.thread.convId) {
        this.thread = syncPersisted(this.thread, await this.fetch(this.thread.convId));
      }
    }
  }

  rows(): Array<{ role: string; content: string }> {
    return this.thread.items
      .filter((i): i is Extract<ThreadState['items'][number], { kind: 'msg' }> => i.kind === 'msg')
      .map((m) => ({ role: m.role, content: m.content }));
  }
}

function frameMsg(fill = 3000): { t: 'frame'; pcm: ArrayBuffer } {
  return { t: 'frame', pcm: new Int16Array(512).fill(fill).buffer };
}

/** Runs one voice exchange end-to-end under fake timers: wake → frames → final → done. */
async function speakOneTurn(r: Rig): Promise<void> {
  r.vc.onWake();
  await Promise.resolve();
  r.vc.onWorkerMessage(frameMsg());
  await vi.advanceTimersByTimeAsync(600); // fixture: partial then final
  await vi.runOnlyPendingTimersAsync();
  await Promise.all(completions); // orchestrator turn completion
}

afterEach(() => vi.useRealTimers());

describe('K5 shared thread — one brain, two surfaces', () => {
  it('a FakeSTT voice turn appears in the open Chat thread; a typed follow-up continues the same conversation with context', async () => {
    vi.useFakeTimers();
    const r = rig([{ text: 'It is 72 and sunny.' }, { text: 'Tomorrow looks similar, 74.' }]);
    const tab = await TabSim.open(r); // the Chat tab is open BEFORE the user speaks

    // 1) Voice turn through the real VoiceController.
    await speakOneTurn(r);
    await tab.drain();

    const voiceConv = (events.find((e) => e.type === 'turnStart') as Extract<AgentEvent, { type: 'turnStart' }>).convId;
    expect(tab.thread.convId).toBe(voiceConv); // the tab shows the SAME conversation
    expect(tab.rows()).toEqual([
      { role: 'user', content: "what's the weather like" },
      { role: 'assistant', content: 'It is 72 and sunny.' },
    ]);

    // 2) Typed follow-up through the REAL chat.send handler.
    const before = events.length;
    await r.handlers['chat.send']({ text: 'and tomorrow?', convId: tab.thread.convId ?? '' }, undefined);
    await vi.runOnlyPendingTimersAsync();
    await tab.drain();

    const secondStart = events.slice(before).find((e) => e.type === 'turnStart') as Extract<AgentEvent, { type: 'turnStart' }>;
    expect(secondStart.convId).toBe(voiceConv); // same conversation, not a fork

    // Context continuity: the second LLM request carries the voice exchange.
    const secondReq = JSON.stringify(r.llm.requests[1]!.messages);
    expect(secondReq).toContain("what's the weather like");
    expect(secondReq).toContain('It is 72 and sunny.');

    // The thread shows the full two-turn transcript in order, no duplicates.
    expect(tab.rows()).toEqual([
      { role: 'user', content: "what's the weather like" },
      { role: 'assistant', content: 'It is 72 and sunny.' },
      { role: 'user', content: 'and tomorrow?' },
      { role: 'assistant', content: 'Tomorrow looks similar, 74.' },
    ]);
  });

  it('a confirmation approved from the Chat surface executes the same agent.confirm path', async () => {
    const r = rig(
      [
        { toolUses: [{ name: 'email.send', input: { to: ['jane@x.com'], subject: 'Hi', body: 'Hello' } }] },
        { text: 'Sent.' },
      ],
      { cancelWindowMs: 5 },
    );
    const { turnId } = (await r.handlers['chat.send']({ text: 'email jane@x.com saying hello', convId: r.cm.current() }, undefined)) as { turnId: string };
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'confirmRequest')).toBe(true);
    });
    expect(turnId).toBeTruthy();
    const confirm = events.find((e) => e.type === 'confirmRequest') as Extract<AgentEvent, { type: 'confirmRequest' }>;
    expect(sentEmails).toHaveLength(0); // gated until approved

    await r.handlers['agent.confirm']({ confirmationId: confirm.confirmationId, approved: true }, undefined);
    await vi.waitFor(() => {
      expect(sentEmails).toHaveLength(1); // identical Tier-3 path as the orb
    });
  });

  it('chat.stop aborts an in-flight stream through the same cancel path', async () => {
    const r = rig([{ text: 'This reply will be aborted midway.', delayMs: 300 }]);
    const { turnId } = (await r.handlers['chat.send']({ text: 'slow question', convId: r.cm.current() }, undefined)) as { turnId: string };
    await new Promise((res) => setTimeout(res, 20)); // stream is in flight
    await r.handlers['chat.stop']({ turnId }, undefined);
    await vi.waitFor(() => {
      const types = events.map((e) => e.type);
      expect(types.includes('done') || types.includes('error')).toBe(true); // turn closed, no hang
    });
    expect(events.map((e) => e.type)).not.toContain('token'); // aborted before any text arrived
  });

  it('the fast path works from Chat with the LLM disabled (timer created offline)', async () => {
    const r = rig([], { llmDown: true });
    await r.handlers['chat.send']({ text: 'set a timer for 5 minutes', convId: r.cm.current() }, undefined);
    await vi.waitFor(() => {
      expect(events.map((e) => e.type)).toContain('done'); // turn fully closed
    });
    expect(repos.timers.listActive()).toHaveLength(1); // no LLM involved
    expect(events.map((e) => e.type)).toContain('card');
    expect(events.map((e) => e.type)).not.toContain('error');
  });

  it('dictation-into-composer streams transcripts and never dispatches a turn', async () => {
    vi.useFakeTimers();
    const r = rig([]);
    const texts: Array<{ text: string; final: boolean }> = [];

    const ok = await r.vc.startDictation((text, final) => texts.push({ text, final }));
    expect(ok).toBe(true);
    expect(r.vc.isDictating()).toBe(true);
    r.vc.onWake(); // wake must not steal the mic from the composer
    expect(r.vc.isDictating()).toBe(true);

    await vi.advanceTimersByTimeAsync(600); // fixture: partials then final + endpoint
    expect(texts.some((t) => !t.final && t.text.length > 0)).toBe(true); // streamed partials
    expect(texts.at(-1)).toEqual({ text: "what's the weather like", final: true });

    // The whole point: nothing was sent to the orchestrator.
    expect(completions).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(r.vc.isDictating()).toBe(false);
    expect(r.vc.state()).toBe('idle');
  });

  it('stopDictation ends the session early and emits what was heard as final', async () => {
    vi.useFakeTimers();
    const r = rig([]);
    const texts: Array<{ text: string; final: boolean }> = [];
    await r.vc.startDictation((text, final) => texts.push({ text, final }));
    await vi.advanceTimersByTimeAsync(250); // only the first partial has arrived
    r.vc.stopDictation();
    expect(texts.at(-1)).toEqual({ text: "what's the", final: true });
    expect(completions).toHaveLength(0);
    expect(r.vc.isDictating()).toBe(false);
  });

  it('New chat from the sidebar rotates the shared conversation for BOTH surfaces', async () => {
    vi.useFakeTimers();
    const r = rig([{ text: 'First.' }, { text: 'Second.' }]);
    await r.handlers['chat.send']({ text: 'hello there', convId: r.cm.current() }, undefined);
    await vi.runOnlyPendingTimersAsync();
    const first = r.cm.current();

    const { id: fresh } = (await r.handlers['conversations.new']({}, undefined)) as { ok: true; id: string };
    expect(fresh).not.toBe(first);
    expect(r.cm.current()).toBe(fresh); // voice will use the fresh conversation too

    // The next voice turn lands in the fresh conversation.
    await speakOneTurn(r);
    const starts = events.filter((e): e is Extract<AgentEvent, { type: 'turnStart' }> => e.type === 'turnStart');
    expect(starts.at(-1)!.convId).toBe(fresh);
  });
});
