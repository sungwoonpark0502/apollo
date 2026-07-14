import { describe, expect, it } from 'vitest';
import { createEmailTools } from '../tools/email';
import { type EmailProvider } from './emailProvider';
import { type ContactsRepo } from '../db/repos/contacts';
import { type ToolCtx } from '@apollo/shared';

/** A provider that would work, so the ERROR must come from the reauth gate, not connectivity. */
const workingProvider = {
  isConnected: () => true,
  list: async () => [],
  read: async () => ({ id: 'm1', from: 'a@b.c', to: [], subject: 's', ts: 0, safeHtml: '', plainText: '', remoteImagesBlocked: 0 }),
  search: async () => [],
  send: async () => ({ id: 'sent1' }),
} as unknown as EmailProvider;
const contacts = { findByEmail: () => [], findByName: () => [] } as unknown as ContactsRepo;
const ctx = { convId: 'c', turnId: 't', userUtterances: [] } as unknown as ToolCtx;

describe('Gmail re-auth gate (H3)', () => {
  it('every networked email tool ERRORs with reauth guidance when needsReauth is true', async () => {
    const tools = createEmailTools({ provider: () => workingProvider, contacts, needsReauth: () => true });
    for (const name of ['email.list', 'email.read', 'email.search', 'email.send']) {
      const tool = tools.find((t) => t.name === name)!;
      const res = await tool.execute({ id: 'm1', query: 'x', to: ['a@b.c'], subject: 's', body: 'b' } as never, ctx);
      expect(res.llmText).toContain('ERROR');
      expect(res.llmText.toLowerCase()).toContain('reconnect');
    }
  });

  it('tools proceed normally when reauth is not needed', async () => {
    const tools = createEmailTools({ provider: () => workingProvider, contacts, needsReauth: () => false });
    const list = tools.find((t) => t.name === 'email.list')!;
    const res = await list.execute({} as never, ctx);
    expect(res.llmText).not.toContain('reconnect');
  });
});
