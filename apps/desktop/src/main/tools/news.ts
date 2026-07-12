import { z } from 'zod';
import Parser from 'rss-parser';
import { type ToolDef } from '@apollo/shared';
import { type HttpClient } from '../net/httpClient';
import { type FeedsRepo } from '../db/repos/misc';
import { type LlmClient } from '../agent/llm';

/** One LLM call for all summaries (C7). Returns null on any failure so the tool degrades to snippets. */
export function createLlmSummarizer(llm: LlmClient): (items: Array<{ title: string; snippet: string }>) => Promise<string[] | null> {
  return async (items) => {
    try {
      let streamed = '';
      const res = await llm.stream({
        system:
          'You summarize news items. Reply with only a JSON array of strings: one summary of exactly 2 short sentences per item, in the same order as the input. No markdown, no other text.',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(items) }] }],
        tools: [],
        maxTokens: 1024,
        onText: (t) => {
          streamed += t;
        },
      });
      const raw = res.text || streamed;
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) return null;
      const arr: unknown = JSON.parse(m[0]);
      return Array.isArray(arr) ? arr.map(String) : null;
    } catch {
      return null;
    }
  };
}

export interface NewsToolDeps {
  http: HttpClient;
  feeds: FeedsRepo;
  /** One LLM call summarizing all items (2 sentences each); null → fall back to feed snippets. */
  summarize?: (items: Array<{ title: string; snippet: string }>) => Promise<string[] | null>;
}

export const DEFAULT_FEEDS: Array<{ url: string; category: string }> = [
  { url: 'https://feeds.apnews.com/rss/apf-topnews', category: 'news' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'news' },
  { url: 'https://www.theverge.com/rss/index.xml', category: 'tech' },
  { url: 'https://hnrss.org/frontpage', category: 'tech' },
];

/** Canonical URL for dedupe: lowercase host, no query/fragment, no trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

interface FeedItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  ts: number;
}

export function createNewsTool(deps: NewsToolDeps): ToolDef {
  const parser = new Parser();

  const params = z.object({ category: z.string().optional() });
  const brief: ToolDef<typeof params> = {
    name: 'news.brief',
    tier: 1,
    networked: true,
    description:
      'Fetch and summarize headlines from the user\'s feeds. Optional category filter (e.g. "tech", "news"). Use for "what\'s in the news".',
    params,
    async execute(a) {
      const feeds = deps.feeds.list({ enabledOnly: true, category: a.category });
      if (feeds.length === 0) {
        return { llmText: a.category ? `WARNING no enabled feeds in category "${a.category}".` : 'WARNING no news feeds are configured.' };
      }

      const items: FeedItem[] = [];
      const failures: string[] = [];
      await Promise.all(
        feeds.map(async (f) => {
          try {
            const xml = await deps.http.getText(f.url, { timeoutMs: 8000 });
            const parsed = await parser.parseString(xml);
            const source = parsed.title ?? new URL(f.url).hostname;
            for (const it of parsed.items.slice(0, 15)) {
              if (!it.title || !it.link) continue;
              items.push({
                title: it.title,
                url: it.link,
                source,
                snippet: (it.contentSnippet ?? it.content ?? '').slice(0, 300),
                ts: it.isoDate ? Date.parse(it.isoDate) : 0,
              });
            }
          } catch {
            failures.push(new URL(f.url).hostname);
          }
        }),
      );

      if (items.length === 0) {
        return { llmText: `ERROR no feed could be fetched${failures.length ? ` (failed: ${failures.join(', ')})` : ''}.` };
      }

      // dedupe by canonical URL, newest first, top 8 (C7)
      const seen = new Set<string>();
      const top = items
        .sort((x, y) => y.ts - x.ts)
        .filter((it) => {
          const c = canonicalUrl(it.url);
          if (seen.has(c)) return false;
          seen.add(c);
          return true;
        })
        .slice(0, 8);

      let summaries: string[] | null = null;
      if (deps.summarize) {
        try {
          summaries = await deps.summarize(top.map((t) => ({ title: t.title, snippet: t.snippet })));
        } catch {
          summaries = null; // degrade to snippets
        }
      }

      const withSummaries = top.map((t, i) => ({
        ...t,
        summary: summaries?.[i]?.trim() || t.snippet.slice(0, 200) || t.title,
      }));

      const warning = failures.length ? ` WARNING could not fetch: ${failures.join(', ')}.` : '';
      return {
        llmText:
          withSummaries.map((t, i) => `${i + 1}. ${t.title} (${t.source}) — ${t.summary}`).join('\n') + warning,
        card: {
          kind: 'newsList',
          items: withSummaries.map((t) => ({ title: t.title, source: t.source, url: t.url, summary: t.summary })),
        },
        untrusted: true,
      };
    },
  };
  return brief;
}
