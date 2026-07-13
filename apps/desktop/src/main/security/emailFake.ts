import { newId, nowMs, type EmailSummary } from '@apollo/shared';
import { type EmailDraft, type EmailProvider, type EmailRaw } from './emailProvider';

/**
 * FakeEmailProvider: an in-memory inbox for tests and for running the app with
 * no Google account. Seeded with a few messages incl. a hostile one for the
 * injection suite. send() records drafts instead of transmitting.
 */
export class FakeEmailProvider implements EmailProvider {
  public readonly sent: EmailDraft[] = [];
  private readonly inbox = new Map<string, EmailRaw>();
  private connected: boolean;

  constructor(seed: EmailRaw[] = defaultSeed(), opts: { connected?: boolean } = {}) {
    for (const m of seed) this.inbox.set(m.id, m);
    this.connected = opts.connected ?? true;
  }

  private summaries(): EmailSummary[] {
    return [...this.inbox.values()]
      .sort((a, b) => b.ts - a.ts)
      .map((m) => ({ id: m.id, from: m.from, subject: m.subject, snippet: m.plainText.slice(0, 120), ts: m.ts, unread: m.unread }));
  }

  list(q?: string, max = 20): Promise<EmailSummary[]> {
    let out = this.summaries();
    if (q) out = out.filter((m) => `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(q.toLowerCase()));
    return Promise.resolve(out.slice(0, max));
  }

  read(id: string): Promise<EmailRaw> {
    const m = this.inbox.get(id);
    if (!m) return Promise.reject(new Error('not found'));
    return Promise.resolve(m);
  }

  search(q: string, max = 20): Promise<EmailSummary[]> {
    return this.list(q, max);
  }

  send(draft: EmailDraft): Promise<{ id: string }> {
    this.sent.push(draft);
    return Promise.resolve({ id: newId() });
  }

  isConnected(): boolean {
    return this.connected;
  }

  address(): string | null {
    return this.connected ? 'you@example.com' : null;
  }
}

function defaultSeed(): EmailRaw[] {
  const t = nowMs();
  return [
    {
      id: 'seed-1',
      from: 'landlord@rentals.example',
      to: ['you@example.com'],
      subject: 'Re: lease renewal',
      ts: t - 3_600_000,
      html: '<p>Hi, the renewal terms look good. Can you confirm by Friday?</p>',
      plainText: 'Hi, the renewal terms look good. Can you confirm by Friday?',
      unread: true,
    },
    {
      id: 'seed-2',
      from: 'newsletter@tech.example',
      to: ['you@example.com'],
      subject: 'Weekly digest',
      ts: t - 7_200_000,
      html: '<p>Top stories this week.</p><img src="https://tracker.example/p.gif">',
      plainText: 'Top stories this week.',
      unread: false,
    },
  ];
}
