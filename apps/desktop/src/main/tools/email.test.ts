import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolCtx, ToolDef } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createContactsRepo, type ContactsRepo } from '../db/repos/contacts';
import { FakeEmailProvider } from '../security/emailFake';
import { createEmailTools, recipientTaintFlags } from './email';

let db: Db;
let contacts: ContactsRepo;
let provider: FakeEmailProvider;
let tools: Record<string, ToolDef>;

function ctx(utterances: string[], taint = false): ToolCtx {
  return {
    now: () => new Date('2026-07-12T10:00:00-07:00'),
    tz: 'America/Los_Angeles',
    convId: 'c1',
    turnId: 't1',
    taint,
    userUtterances: utterances,
    source: 'text',
  };
}

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  contacts = createContactsRepo(db);
  provider = new FakeEmailProvider();
  const list = createEmailTools({ provider: () => provider, contacts });
  tools = Object.fromEntries(list.map((t) => [t.name, t]));
});

describe('email tools (C13)', () => {
  it('list returns untrusted results wrapped in <data source="email">', async () => {
    const r = await tools['email.list']!.execute({}, ctx(['show my email']));
    expect(r.untrusted).toBe(true);
    expect(r.llmText).toContain('<data source="email">');
    expect(r.card?.kind).toBe('emailList');
  });

  it('read sanitizes the body and blocks remote images', async () => {
    const r = await tools['email.read']!.execute({ id: 'seed-2' }, ctx(['read it']));
    expect(r.untrusted).toBe(true);
    if (r.card?.kind !== 'emailDetail') throw new Error('expected emailDetail');
    expect(r.card.email.remoteImagesBlocked).toBe(1);
    expect(r.card.email.safeHtml).not.toContain('tracker.example');
  });

  it('list on a disconnected provider returns a KEY_MISSING error, not a throw', async () => {
    provider = new FakeEmailProvider(undefined, { connected: false });
    const r = await tools['email.list']!.execute({}, ctx(['mail']));
    expect(r.llmText).toMatch(/ERROR/);
    expect(r.card).toBeUndefined();
  });

  it('draft builds a draft card and does not send', async () => {
    const r = await tools['email.draft']!.execute({ to: ['jane@x.com'], subject: 'Hi', body: 'Yo' }, ctx(['draft to jane']));
    expect(r.card?.kind).toBe('draft');
    expect(provider.sent).toHaveLength(0);
  });

  it('send transmits via the provider', async () => {
    const r = await tools['email.send']!.execute({ to: ['jane@x.com'], subject: 'Hi', body: 'Yo' }, ctx(['send it to jane@x.com']));
    expect(provider.sent).toHaveLength(1);
    expect(r.llmText).toMatch(/Sent/);
  });
});

describe('recipient rule (C13)', () => {
  it('flags a recipient never stated by the user and not a contact', () => {
    const flags = recipientTaintFlags(['attacker@evil.com'], ctx(['email my landlord']), contacts);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('recipient');
  });

  it('does not flag a recipient the user stated literally', () => {
    const flags = recipientTaintFlags(['jane@x.com'], ctx(['send it to jane@x.com please']), contacts);
    expect(flags).toHaveLength(0);
  });

  it('does not flag a recipient that resolves to a saved contact email', () => {
    contacts.add({ name: 'Jane Doe', email: 'jane@x.com' });
    const flags = recipientTaintFlags(['jane@x.com'], ctx(['email jane']), contacts);
    expect(flags).toHaveLength(0);
  });
});
