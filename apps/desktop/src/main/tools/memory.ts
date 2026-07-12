import { z } from 'zod';
import { type ToolDef } from '@apollo/shared';
import { MEMORY_CATEGORIES, type MemoryRepo } from '../db/repos/memory';
import { type UndoRepo } from '../db/repos/undo';

export interface MemoryToolDeps {
  memory: MemoryRepo;
  undo: UndoRepo;
}

export function createMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  const save: ToolDef<z.ZodType<{ category: (typeof MEMORY_CATEGORIES)[number]; fact: string }>> = {
    name: 'memory.save',
    tier: 2,
    description:
      'Remember a durable fact about the user ("user\'s partner lives in Columbus"). Only for stable facts worth recalling in future conversations, not transient context.',
    params: z.object({ category: z.enum(MEMORY_CATEGORIES), fact: z.string().min(1) }),
    async execute(a, ctx) {
      const f = deps.memory.save({ category: a.category, fact: a.fact, sourceConvId: ctx.convId });
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.save', data: { id: f.id } });
      return { llmText: `Remembered (${a.category}): ${a.fact}`, undoToken };
    },
  };

  const forget: ToolDef<z.ZodType<{ fact: string }>> = {
    name: 'memory.forget',
    tier: 2,
    description: 'Forget a remembered fact by fuzzy match on its content.',
    params: z.object({ fact: z.string().min(1) }),
    async execute(a, ctx) {
      const removed = deps.memory.forgetFuzzy(a.fact);
      if (!removed) return { llmText: `WARNING no remembered fact matched "${a.fact}".` };
      const undoToken = deps.undo.push({ turnId: ctx.turnId, convId: ctx.convId, tool: 'memory.forget', data: { id: removed.id } });
      return { llmText: `Forgot: "${removed.fact}".`, undoToken };
    },
  };

  return [save, forget];
}
