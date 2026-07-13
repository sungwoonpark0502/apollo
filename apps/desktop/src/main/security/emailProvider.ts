import { type EmailSummary } from '@apollo/shared';

/** C13: provider boundary so IMAP can come later. All results are untrusted. */
export interface EmailDraft {
  to: string[];
  subject: string;
  body: string;
}

export interface EmailRaw {
  id: string;
  from: string;
  to: string[];
  subject: string;
  ts: number;
  html: string;      // raw HTML body (sanitized by the tool layer before display)
  plainText: string; // provider-extracted text fallback
  unread: boolean;
}

export interface EmailProvider {
  list(q?: string, max?: number): Promise<EmailSummary[]>;
  read(id: string): Promise<EmailRaw>;
  search(q: string, max?: number): Promise<EmailSummary[]>;
  send(draft: EmailDraft): Promise<{ id: string }>;
  isConnected(): boolean;
  address(): string | null;
}
