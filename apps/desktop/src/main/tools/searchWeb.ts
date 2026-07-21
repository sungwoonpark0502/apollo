import { z } from 'zod';
import { STRINGS, type SearchResponse, type ToolDef } from '@apollo/shared';
import { type HttpClient } from '../net/httpClient';

export interface SearchToolDeps {
  http: HttpClient;
  getBraveKey: () => string | null;
  /**
   * L0.2 managed transport. When present, search goes through the Apollo
   * backend (which holds the Brave key) instead of a local key. The tool's
   * behavior, card, and taint marking are identical either way.
   */
  managedSearch?: (query: string) => Promise<SearchResponse>;
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
      const results = deps.managedSearch ? await viaBackend(a.query) : await viaLocalKey(a.query);
      if (results === null) {
        // Tells the model the capability is off so it can say so plainly.
        // Deliberately names no vendor and no settings screen.
        return { llmText: `ERROR CAPABILITY_OFF: ${STRINGS.errors.CAPABILITY_OFF('Web search')} Answer from what you already know, and say you could not search.` };
      }
      if (results.length === 0) return { llmText: `No web results for "${a.query}".`, untrusted: true };
      return {
        llmText: results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.url})`).join('\n'),
        card: {
          kind: 'newsList',
          items: results.map((r) => ({ title: r.title, source: new URL(r.url).hostname, url: r.url, summary: r.snippet })),
        },
        untrusted: true,
      };
    },
  };

  async function viaBackend(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
    return (await deps.managedSearch!(query)).results.slice(0, 5);
  }

  /** null = no key configured (BYOK only). */
  async function viaLocalKey(query: string): Promise<Array<{ title: string; url: string; snippet: string }> | null> {
    const key = deps.getBraveKey();
    if (!key) return null;
    const data = (await deps.http.getJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } },
    )) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
    return (data.web?.results ?? []).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
  }

  return search;
}
