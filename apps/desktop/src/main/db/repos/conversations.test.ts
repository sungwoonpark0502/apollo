import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../connection';
import { migrate } from '../migrate';
import { createRepos, type Repos } from './index';
import { FakeEmbedder } from '../../memory/embedder';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

describe('conversations list/get/delete (H5)', () => {
  it('summaries derive the title from the first user message and count turns', () => {
    repos.conversations.ensure('c1');
    repos.conversations.addMessage({ convId: 'c1', role: 'user', content: 'set a timer for five minutes please', ts: 10 });
    repos.conversations.addMessage({ convId: 'c1', role: 'assistant', content: 'Timer set.', ts: 11 });
    const list = repos.conversations.listSummaries();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('set a timer for five minutes please');
    expect(list[0]!.messageCount).toBe(2);
  });

  it('get returns chronological user/assistant messages', () => {
    repos.conversations.ensure('c1');
    repos.conversations.addMessage({ convId: 'c1', role: 'user', content: 'hi', ts: 2 });
    repos.conversations.addMessage({ convId: 'c1', role: 'assistant', content: 'hello', ts: 3 });
    repos.conversations.addMessage({ convId: 'c1', role: 'tool', content: 'internal', ts: 4 });
    const msgs = repos.conversations.messagesOf('c1');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']); // tool rows excluded
  });

  it('delete purges the conversation AND its indexed message chunks/vectors', async () => {
    repos.conversations.ensure('c1');
    repos.conversations.addMessage({ convId: 'c1', role: 'user', content: 'we talked about the lake house', ts: 5 });
    // index a message chunk for this conversation
    const embedder = new FakeEmbedder();
    const rows = repos.chunks.replaceForRef('message', 'm1', ['we talked about the lake house'], { convId: 'c1', ts: 5 });
    repos.chunks.setEmbedding(rows[0]!.id, (await embedder.embed(['x']))[0]!);
    expect(repos.chunks.countByKind().message).toBe(1);

    const purged = repos.chunks.purgeConversation('c1');
    repos.conversations.deleteConversation('c1');

    expect(purged).toBe(1);
    expect(repos.chunks.countByKind().message).toBe(0);
    expect(repos.conversations.listSummaries()).toHaveLength(0);
    expect(repos.chunks.knn((await embedder.embed(['x']))[0]!, 5).some((h) => h.chunkId === rows[0]!.id)).toBe(false);
  });

  it('empty conversations are excluded from summaries', () => {
    repos.conversations.ensure('empty');
    expect(repos.conversations.listSummaries()).toHaveLength(0);
  });
});
