import { z } from 'zod';
import { STRINGS, type ToolDef } from '@apollo/shared';
import { type HttpClient } from '../net/httpClient';

export interface SearchToolDeps {
  http: HttpClient;
  getBraveKey: () => string | null;
}

export function createSearchWebTool(deps: SearchToolDeps): ToolDef {
  const search: ToolDef<z.ZodType<{ query: string }>> = {
    name: 'search.web',
    tier: 1,
    networked: true,
    description:
      'Web search (Brave). Use for current events, facts you are unsure about, or anything outside the other tools. Returns the top 5 results.',
    params: z.object({ query: z.string().min(1) }),
    async execute(a) {
      const key = deps.getBraveKey();
      if (!key) {
        return { llmText: `ERROR KEY_MISSING: ${STRINGS.errors.KEY_MISSING('Brave Search')} Web search is unavailable until a key is added.` };
      }
      const data = (await deps.http.getJson(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(a.query)}&count=5`,
        { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } },
      )) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
      const results = (data.web?.results ?? []).slice(0, 5);
      if (results.length === 0) return { llmText: `No web results for "${a.query}".`, untrusted: true };
      return {
        llmText: results.map((r, i) => `${i + 1}. ${r.title} — ${r.description ?? ''} (${r.url})`).join('\n'),
        card: {
          kind: 'newsList',
          items: results.map((r) => ({ title: r.title, source: new URL(r.url).hostname, url: r.url, summary: r.description ?? '' })),
        },
        untrusted: true,
      };
    },
  };
  return search;
}
