import { type Repos } from '../db/repos/index';
import { type Embedder } from './embedder';
import { chunkFact, chunkMessage, chunkNote } from './chunker';

const NOTE_DEBOUNCE_MS = 5_000;
const EMBED_BATCH = 8;
const GROWTH_CAP = 50_000;

export interface IndexerDeps {
  repos: Repos;
  embedder: Embedder;
  historyEnabled: () => boolean;
  /** Drains only when no agent turn is active and voice is idle (G3). */
  canDrain: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  log?: (msg: string) => void;
}

export function createIndexer(deps: IndexerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => { const h = setTimeout(fn, Math.max(0, ms)); return { cancel: () => clearTimeout(h) }; });

  const noteTimers = new Map<string, { cancel: () => void }>();
  let unsub: (() => void) | null = null;
  let draining = false;
  let stopped = false;

  function rechunkNote(noteId: string): void {
    const note = deps.repos.notes.get(noteId);
    if (!note || note.deletedAt) {
      deps.repos.chunks.removeForRef('note', noteId);
      return;
    }
    deps.repos.chunks.replaceForRef('note', noteId, chunkNote(note.content), { ts: note.updatedAt });
    pump();
  }

  /** Note create/update: debounce 5s after the last change, then re-chunk. */
  function onNoteChanged(noteId: string): void {
    noteTimers.get(noteId)?.cancel();
    noteTimers.set(noteId, setTimer(() => {
      noteTimers.delete(noteId);
      rechunkNote(noteId);
    }, NOTE_DEBOUNCE_MS));
  }

  function onNoteDeleted(noteId: string): void {
    noteTimers.get(noteId)?.cancel();
    noteTimers.delete(noteId);
    deps.repos.chunks.removeForRef('note', noteId);
  }

  /** Message persisted (only while history is enabled). */
  function onMessagePersisted(msg: { id: string; convId: string; content: string; ts: number }): void {
    if (!deps.historyEnabled()) return;
    const chunks = chunkMessage(msg.content);
    if (chunks.length === 0) return;
    deps.repos.chunks.replaceForRef('message', msg.id, chunks, { convId: msg.convId, ts: msg.ts });
    pump();
  }

  function onFactSaved(fact: { id: string; category: string; fact: string; ts: number }): void {
    deps.repos.chunks.replaceForRef('fact', fact.id, chunkFact(fact.category, fact.fact), { ts: fact.ts });
    pump();
  }

  function onFactForgotten(factId: string): void {
    deps.repos.chunks.removeForRef('fact', factId);
  }

  /** History toggled off: purge all message chunks+vectors immediately (G3/G7). */
  function onHistoryToggled(enabled: boolean): void {
    if (!enabled) deps.repos.chunks.purgeKind('message');
  }

  function enforceGrowthCap(): void {
    const total = deps.repos.chunks.count();
    if (total > GROWTH_CAP) deps.repos.chunks.pruneOldestMessages(total - GROWTH_CAP);
  }

  /** Embeds all pending chunks in batches of 8, gated by canDrain, yielding between batches. */
  async function drainNow(): Promise<void> {
    if (draining || stopped) return;
    draining = true;
    try {
      for (;;) {
        if (stopped || !deps.canDrain()) break;
        const pending = deps.repos.chunks.pendingEmbedding(EMBED_BATCH);
        if (pending.length === 0) break;
        const vectors = await deps.embedder.embed(pending.map((c) => c.text));
        const at = now();
        for (let i = 0; i < pending.length; i++) {
          const v = vectors[i];
          if (v) deps.repos.chunks.setEmbedding(pending[i]!.id, v, at);
        }
        enforceGrowthCap();
        await Promise.resolve(); // yield to the event loop between batches
      }
    } catch (e) {
      deps.log?.(`indexer drain failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      draining = false;
    }
  }

  /** Schedule a drain if the gate is open (called after enqueues and when a turn ends). */
  function pump(): void {
    if (stopped || !deps.canDrain()) return;
    setTimer(() => void drainNow(), 0);
  }

  return {
    start(): void {
      stopped = false;
      unsub = deps.repos.bus.subscribe((change) => {
        if (change.entity !== 'note') return;
        if (change.op === 'delete') onNoteDeleted(change.id);
        else onNoteChanged(change.id);
      });
      // Boot rescan: anything left unembedded from a prior run drains now (G3).
      pump();
    },
    onMessagePersisted,
    onFactSaved,
    onFactForgotten,
    onHistoryToggled,
    /** Called when a turn ends / voice returns to idle so the queue can drain. */
    pump,
    drainNow,
    /** Rebuild: purge and re-chunk the whole corpus from repos (G7). */
    rebuild(): void {
      deps.repos.chunks.purgeAll();
      for (const note of allNotes(deps.repos)) deps.repos.chunks.replaceForRef('note', note.id, chunkNote(note.content), { ts: note.updatedAt });
      for (const f of deps.repos.memory.list()) deps.repos.chunks.replaceForRef('fact', f.id, chunkFact(f.category, f.fact), { ts: f.updatedAt });
      if (deps.historyEnabled()) {
        for (const m of allMessages(deps.repos)) deps.repos.chunks.replaceForRef('message', m.id, chunkMessage(m.content), { convId: m.convId, ts: m.ts });
      }
      pump();
    },
    stop(): void {
      stopped = true;
      for (const t of noteTimers.values()) t.cancel();
      noteTimers.clear();
      unsub?.();
    },
  };
}

export type Indexer = ReturnType<typeof createIndexer>;

// Corpus scans for rebuild; kept here so the repos surface stays lean.
function allNotes(repos: Repos): Array<{ id: string; content: string; updatedAt: number }> {
  return repos.notes.list({ limit: 200 }).map((n) => {
    const full = repos.notes.get(n.id);
    return { id: n.id, content: full?.content ?? '', updatedAt: full?.updatedAt ?? n.updatedAt };
  });
}
function allMessages(repos: Repos): Array<{ id: string; convId: string; content: string; ts: number }> {
  return repos.conversations.recentAll(5000).map((m) => ({ id: m.id, convId: m.convId, content: m.content, ts: m.ts }));
}
