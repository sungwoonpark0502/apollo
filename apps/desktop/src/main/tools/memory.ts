import { z } from 'zod';
import { type ToolDef } from '@apollo/shared';
import { MEMORY_CATEGORIES, type MemoryRepo } from '../db/repos/memory';
import { type UndoRepo } from '../db/repos/undo';
import { type Embedder } from '../memory/embedder';
import { matchFact, resolveForget } from '../memory/factMatch';

export interface MemoryToolDeps {
  memory: MemoryRepo;
  undo: UndoRepo;
  /** G5: embedder for dedupe/replace/forget-by-similarity. Optional → keyword fallback. */
  embedder?: Embedder;
  /** G3: notify the indexer to (re)embed or remove a fact's chunk. */
  onFactSaved?: (fact: { id: string; category: string; fact: string; ts: number }) => void;
  onFactForgotten?: (factId: string) => void;
}

export function createMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  const save: ToolDef<z.ZodType<{ category: (typeof MEMORY_CATEGORIES)[number]; fact: string }>> = {
    name: 'memory.save',
    tier: 2,
    description:
      'Remember a durable fact about the user ("user\'s partner lives in Columbus"). Only for stable facts worth recalling in future conversations, not transient context.',
    params: z.object({ category: z.enum(MEMORY_CATEGORIES), fact: z.string().min(1) }),
    async execute(a, ctx) {
      // G5: compare against existing same-category facts by meaning before inserting.
      if (deps.embedder) {
        const candidates = deps.memory.listByCategory(a.category).map((f) => ({ id: f.id, fact: f.fact }));
        const match = await matchFact(deps.embedder, a.fact, candidates);
        if (match.action === 'update' && match.target) {
          const updated = deps.memory.updateText(match.target.id, a.fact);
          if (updated) deps.onFactSaved?.({ id: updated.id, category: a.category, fact: a.fact, ts: updated.updatedAt });
          const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.save', data: { id: match.target.id } });
          return { llmText: `Updated what I knew (${a.category}): ${a.fact}`, undoToken };
        }
        if (match.action === 'replace' && match.target) {
          deps.memory.delete(match.target.id);
          deps.onFactForgotten?.(match.target.id);
          const f = deps.memory.save({ category: a.category, fact: a.fact, sourceConvId: ctx.convId });
          deps.onFactSaved?.({ id: f.id, category: f.category, fact: f.fact, ts: f.updatedAt });
          const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.replace', data: { newId: f.id, oldId: match.target.id } });
          return { llmText: `Replaced what I knew: "${match.target.fact}" is now "${a.fact}".`, undoToken };
        }
      }
      const f = deps.memory.save({ category: a.category, fact: a.fact, sourceConvId: ctx.convId });
      deps.onFactSaved?.({ id: f.id, category: f.category, fact: f.fact, ts: f.updatedAt });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.save', data: { id: f.id } });
      return { llmText: `Remembered (${a.category}): ${a.fact}`, undoToken };
    },
  };

  const forget: ToolDef<z.ZodType<{ fact: string }>> = {
    name: 'memory.forget',
    tier: 2,
    description: 'Forget a remembered fact by meaning ("forget where my partner lives").',
    params: z.object({ fact: z.string().min(1) }),
    async execute(a, ctx) {
      // G5: resolve by embedding similarity; below threshold, list nearest instead of guessing.
      if (deps.embedder) {
        const candidates = deps.memory.list().map((f) => ({ id: f.id, fact: f.fact }));
        const { hit, nearest } = await resolveForget(deps.embedder, a.fact, candidates);
        if (hit) {
          deps.memory.delete(hit.id);
          deps.onFactForgotten?.(hit.id);
          const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.forget', data: { id: hit.id } });
          return { llmText: `Forgot: "${hit.fact}".`, undoToken };
        }
        if (nearest.length > 0) {
          return { llmText: `WARNING no clear match for "${a.fact}". Did you mean: ${nearest.map((n) => `"${n.fact}"`).join(', ')}? I did nothing.` };
        }
        return { llmText: `WARNING no remembered fact matched "${a.fact}".` };
      }
      const removed = deps.memory.forgetFuzzy(a.fact);
      if (!removed) return { llmText: `WARNING no remembered fact matched "${a.fact}".` };
      deps.onFactForgotten?.(removed.id);
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.forget', data: { id: removed.id } });
      return { llmText: `Forgot: "${removed.fact}".`, undoToken };
    },
  };

  return [save, forget];
}
