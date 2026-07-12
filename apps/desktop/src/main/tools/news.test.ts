import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { canonicalUrl, createNewsTool } from './news';
import { createRegistry, type Registry } from './registry';
import { makeCtx } from './registry.test';
import type { HttpClient } from '../net/httpClient';

function rss(title: string, items: Array<{ title: string; link: string; date: string; desc?: string }>): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate><description>${i.desc ?? ''}</description></item>`)
    .join('')}</channel></rss>`;
}

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function setup(getText: (url: string) => Promise<string>, summarize?: (items: Array<{ title: string; snippet: string }>) => Promise<string[] | null>): Registry {
  const http: HttpClient = {
    getJson: vi.fn(async () => ({})),
    getText: vi.fn(async (url: string) => getText(url)),
    postJson: vi.fn(async () => ({})),
  };
  return createRegistry([createNewsTool({ http, feeds: repos.feeds, summarize })]);
}

describe('canonicalUrl', () => {
  it('strips query, fragment, trailing slash, case', () => {
    expect(canonicalUrl('https://Example.com/story/?utm=1#top')).toBe('example.com/story');
    expect(canonicalUrl('https://example.com/story')).toBe('example.com/story');
  });
});

describe('news.brief', () => {
  it('fetches enabled feeds, dedupes by canonical url, caps at 8 newest, untrusted', async () => {
    repos.feeds.upsert({ url: 'https://a.example.com/rss', category: 'news' });
    repos.feeds.upsert({ url: 'https://b.example.com/rss', category: 'news' });
    const reg = setup(async (url) => {
      if (url.includes('a.example')) {
        return rss('Feed A', [
          { title: 'Shared story', link: 'https://site.com/story?src=a', date: 'Sat, 11 Jul 2026 09:00:00 GMT' },
          ...Array.from({ length: 9 }, (_, i) => ({
            title: `A${i}`,
            link: `https://site.com/a${i}`,
            date: `Sat, 11 Jul 2026 0${i % 8}:00:00 GMT`,
          })),
        ]);
      }
      return rss('Feed B', [{ title: 'Shared story dup', link: 'https://site.com/story/?src=b#x', date: 'Sat, 11 Jul 2026 08:59:00 GMT' }]);
    });

    const res = await reg.execute('news.brief', {}, makeCtx());
    expect(res.untrusted).toBe(true);
    const card = res.card as { kind: 'newsList'; items: Array<{ url: string }> };
    expect(card.items.length).toBeLessThanOrEqual(8);
    // dedupe: only one of the shared stories survives
    const shared = card.items.filter((i) => canonicalUrl(i.url) === 'site.com/story');
    expect(shared).toHaveLength(1);
  });

  it('filters by category', async () => {
    repos.feeds.upsert({ url: 'https://tech.example.com/rss', category: 'tech' });
    repos.feeds.upsert({ url: 'https://news.example.com/rss', category: 'news' });
    const calls: string[] = [];
    const reg = setup(async (url) => {
      calls.push(url);
      return rss('T', [{ title: 'Tech thing', link: 'https://t.com/1', date: 'Sat, 11 Jul 2026 09:00:00 GMT' }]);
    });
    await reg.execute('news.brief', { category: 'tech' }, makeCtx());
    expect(calls).toEqual(['https://tech.example.com/rss']);
  });

  it('degrades per-feed failures with a WARNING naming the feed', async () => {
    repos.feeds.upsert({ url: 'https://good.example.com/rss', category: 'news' });
    repos.feeds.upsert({ url: 'https://dead.example.com/rss', category: 'news' });
    const reg = setup(async (url) => {
      if (url.includes('dead')) throw new Error('boom');
      return rss('Good', [{ title: 'Story', link: 'https://g.com/1', date: 'Sat, 11 Jul 2026 09:00:00 GMT' }]);
    });
    const res = await reg.execute('news.brief', {}, makeCtx());
    expect(res.llmText).toContain('WARNING could not fetch: dead.example.com');
    expect(res.llmText).toContain('Story');
  });

  it('uses one summarize call and falls back to snippets when it fails', async () => {
    repos.feeds.upsert({ url: 'https://a.example.com/rss', category: 'news' });
    const summarize = vi.fn(async () => ['Two sentence summary. Right here.']);
    const reg = setup(
      async () => rss('A', [{ title: 'One', link: 'https://s.com/1', date: 'Sat, 11 Jul 2026 09:00:00 GMT', desc: 'raw snippet' }]),
      summarize,
    );
    const res = await reg.execute('news.brief', {}, makeCtx());
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(res.llmText).toContain('Two sentence summary');

    const reg2 = setup(
      async () => rss('A', [{ title: 'One', link: 'https://s.com/1', date: 'Sat, 11 Jul 2026 09:00:00 GMT', desc: 'raw snippet' }]),
      async () => {
        throw new Error('llm down');
      },
    );
    const res2 = await reg2.execute('news.brief', {}, makeCtx());
    expect(res2.llmText).toContain('raw snippet');
  });

  it('errors helpfully with no feeds and when all feeds fail', async () => {
    const regEmpty = setup(async () => '');
    expect((await regEmpty.execute('news.brief', {}, makeCtx())).llmText).toMatch(/^WARNING no news feeds/);

    repos.feeds.upsert({ url: 'https://dead.example.com/rss', category: 'news' });
    const regDead = setup(async () => {
      throw new Error('nope');
    });
    expect((await regDead.execute('news.brief', {}, makeCtx())).llmText).toMatch(/^ERROR no feed could be fetched/);
  });
});
