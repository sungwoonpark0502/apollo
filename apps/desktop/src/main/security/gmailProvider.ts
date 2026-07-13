import { google, type gmail_v1 } from 'googleapis';
import { type EmailDraft, type EmailProvider, type EmailRaw } from './emailProvider';
import { type EmailSummary } from '@apollo/shared';

/**
 * Gmail adapter (C13). Uses OAuth2 tokens (readonly + send scopes). Bodies are
 * returned raw; the tool layer sanitizes before display. Threads longer than 5
 * messages are pre-summarized upstream; here read() returns the newest message
 * body capped by the tool layer at 4000 chars.
 */
export interface GmailDeps {
  clientId: string;
  clientSecret: string;
  getTokens: () => { accessToken: string; refreshToken: string; expiresAt: number } | null;
  onTokenRefresh: (accessToken: string, expiresAt: number) => void;
  address: () => string | null;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodePart(data: string | null | undefined): string {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Walks the MIME tree collecting text/html (preferred) and text/plain. */
function extractBodies(payload: gmail_v1.Schema$MessagePart | undefined): { html: string; text: string } {
  let html = '';
  let text = '';
  const walk = (part?: gmail_v1.Schema$MessagePart): void => {
    if (!part) return;
    const mime = part.mimeType ?? '';
    if (mime === 'text/html') html += decodePart(part.body?.data);
    else if (mime === 'text/plain') text += decodePart(part.body?.data);
    for (const p of part.parts ?? []) walk(p);
  };
  walk(payload);
  return { html, text };
}

export function createGmailProvider(deps: GmailDeps): EmailProvider {
  function client(): gmail_v1.Gmail {
    const tokens = deps.getTokens();
    if (!tokens) throw new Error('not connected');
    const auth = new google.auth.OAuth2(deps.clientId, deps.clientSecret);
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
    });
    auth.on('tokens', (t) => {
      if (t.access_token) deps.onTokenRefresh(t.access_token, t.expiry_date ?? Date.now() + 3_000_000);
    });
    return google.gmail({ version: 'v1', auth });
  }

  async function toSummary(gmail: gmail_v1.Gmail, id: string): Promise<EmailSummary> {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const d = msg.data;
    return {
      id,
      from: header(d.payload?.headers, 'From'),
      subject: header(d.payload?.headers, 'Subject'),
      snippet: d.snippet ?? '',
      ts: Number(d.internalDate ?? Date.now()),
      unread: (d.labelIds ?? []).includes('UNREAD'),
    };
  }

  async function listIds(q: string | undefined, max: number): Promise<string[]> {
    const gmail = client();
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: max });
    return (res.data.messages ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
  }

  return {
    async list(q, max = 20) {
      const gmail = client();
      const ids = await listIds(q, max);
      return Promise.all(ids.map((id) => toSummary(gmail, id)));
    },
    async search(q, max = 20) {
      const gmail = client();
      const ids = await listIds(q, max);
      return Promise.all(ids.map((id) => toSummary(gmail, id)));
    },
    async read(id): Promise<EmailRaw> {
      const gmail = client();
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const d = msg.data;
      const { html, text } = extractBodies(d.payload);
      const toHeader = header(d.payload?.headers, 'To');
      return {
        id,
        from: header(d.payload?.headers, 'From'),
        to: toHeader ? toHeader.split(',').map((s) => s.trim()) : [],
        subject: header(d.payload?.headers, 'Subject'),
        ts: Number(d.internalDate ?? Date.now()),
        html: html || `<p>${text.replace(/</g, '&lt;')}</p>`,
        plainText: text || '',
        unread: (d.labelIds ?? []).includes('UNREAD'),
      };
    },
    async send(draft: EmailDraft): Promise<{ id: string }> {
      const gmail = client();
      const raw = buildRfc822(draft, deps.address() ?? 'me');
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return { id: res.data.id ?? '' };
    },
    isConnected: () => deps.getTokens() !== null,
    address: deps.address,
  };
}

export function buildRfc822(draft: EmailDraft, from: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${draft.to.join(', ')}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    draft.body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
