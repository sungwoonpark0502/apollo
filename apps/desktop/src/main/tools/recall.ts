import { z } from 'zod';
import { type ToolDef } from '@apollo/shared';
import { type Recall, formatRecallLlmText } from '../memory/recall';

export interface RecallToolDeps {
  recall: Recall;
  tz: () => string;
}

const Params = z.object({
  query: z.string().min(2),
  kinds: z.array(z.enum(['note', 'message', 'fact'])).optional(),
  sinceIso: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(6),
});

/**
 * G4 recall.search: semantic + keyword hybrid over the user's own notes, past
 * messages, and memory facts (on-device). Results are untrusted (notes can hold
 * pasted hostile text) and wrapped in <data source="recall"> by the orchestrator.
 */
export function createRecallTool(deps: RecallToolDeps): ToolDef {
  const tool: ToolDef<typeof Params> = {
    name: 'recall.search',
    tier: 1,
    description:
      'Search the user\'s own notes, past conversations, and saved memory facts by meaning. Use when the user refers to something from before ("that idea I wrote down", "did I ever mention…", "what did I say about X", "last week we discussed"). Not for general knowledge or current events.',
    params: Params,
    async execute(a) {
      const kinds = a.kinds && a.kinds.length ? a.kinds : undefined;
      const items = await deps.recall.search({
        query: a.query,
        ...(kinds ? { kinds } : {}),
        ...(a.sinceIso ? { sinceIso: a.sinceIso } : {}),
        limit: a.limit,
      });
      return {
        llmText: formatRecallLlmText(a.query, items, deps.tz()),
        card: { kind: 'recallList', items },
        untrusted: true, // notes may contain pasted external content (G4)
      };
    },
  };
  return tool;
}
