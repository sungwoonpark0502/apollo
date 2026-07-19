import {
  availableModelsSchema,
  createSseParser,
  tokenResponseSchema,
  type AvailableModels,
  type LlmProviderId,
  type LlmSseEvent,
  type TokenResponse,
} from '@apollo/shared';

/**
 * Phase 13 web client ↔ backend. Same endpoints and wire contract as the
 * desktop's managed transport; the differences are all about running in a
 * browser: tokens live in localStorage (an XSS anywhere on this origin can
 * read them — accepted for v1 and noted in DECISIONS), and every request is
 * CORS-gated server-side to exactly this origin.
 */
declare const __APOLLO_BACKEND__: string;
export const BACKEND = __APOLLO_BACKEND__;

const TOKEN_KEY = 'apollo.web.session.v1';

interface StoredSession {
  refreshToken: string;
  user: { id: string; name: string; email: string; plan: string };
}

let accessToken: string | null = null;
let accessExpiresAt = 0;

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: StoredSession | null): void {
  if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
  else localStorage.removeItem(TOKEN_KEY);
}

function adopt(res: TokenResponse): StoredSession {
  accessToken = res.accessToken;
  accessExpiresAt = Date.now() + res.expiresIn * 1000;
  const s: StoredSession = { refreshToken: res.refreshToken, user: res.user };
  saveSession(s);
  return s;
}

export type AuthResult = { ok: true; user: StoredSession['user'] } | { ok: false; error: string };

async function credentialCall(path: '/auth/login' | '/auth/signup', body: Record<string, unknown>): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (!res.ok) {
    const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    if (res.status === 429) return { ok: false, error: 'tooManyAttempts' };
    if (res.status === 409) return { ok: false, error: 'emailTaken' };
    if (err === 'weak_password') return { ok: false, error: 'weakPassword' };
    return { ok: false, error: 'invalidCredentials' };
  }
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) return { ok: false, error: 'malformed' };
  return { ok: true, user: adopt(parsed.data).user };
}

export const login = (email: string, password: string): Promise<AuthResult> => credentialCall('/auth/login', { email, password });
export const signup = (email: string, password: string, name?: string): Promise<AuthResult> =>
  credentialCall('/auth/signup', { email, password, ...(name ? { name } : {}) });

export async function logout(): Promise<void> {
  const token = await getAccessToken().catch(() => null);
  saveSession(null);
  accessToken = null;
  if (token) {
    await fetch(`${BACKEND}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
}

/** Valid access token, silently rotating the refresh token when near expiry. */
export async function getAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < accessExpiresAt - 30_000) return accessToken;
  const stored = loadSession();
  if (!stored) return null;
  let res: Response;
  try {
    res = await fetch(`${BACKEND}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
  } catch {
    return null; // offline ≠ signed out; retry next call
  }
  if (res.status === 401) {
    saveSession(null); // rotated-out or revoked: a real sign-out
    return null;
  }
  if (!res.ok) return null;
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) return null;
  adopt(parsed.data);
  return accessToken;
}

export async function fetchModels(): Promise<AvailableModels> {
  const token = await getAccessToken();
  if (!token) return { providers: [] };
  try {
    const res = await fetch(`${BACKEND}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { providers: [] };
    return availableModelsSchema.parse(await res.json());
  } catch {
    return { providers: [] };
  }
}

export interface ChatTurnRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }>;
  provider: LlmProviderId;
  model: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export type ChatTurnResult = { ok: true; text: string } | { ok: false; error: 'auth' | 'quota' | 'down' };

/** One streamed turn. Web v1 sends no tools — see DECISIONS on scope. */
export async function chatTurn(req: ChatTurnRequest): Promise<ChatTurnResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'auth' };
  let res: Response;
  try {
    res = await fetch(`${BACKEND}/v1/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        system: req.system,
        messages: req.messages,
        tools: [],
        maxTokens: 2048,
        provider: req.provider,
        model: req.model,
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
  } catch {
    return { ok: false, error: 'down' };
  }
  if (res.status === 401) return { ok: false, error: 'auth' };
  if (res.status === 429) return { ok: false, error: 'quota' };
  if (!res.ok || !res.body) return { ok: false, error: 'down' };

  const parser = createSseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let failed: LlmSseEvent | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const e of parser.push(decoder.decode(value, { stream: true }))) {
      if (e.type === 'text') {
        text += e.delta;
        req.onText(e.delta);
      } else if (e.type === 'error') {
        failed = e;
      }
    }
  }
  if (failed) return { ok: false, error: 'down' };
  return { ok: true, text };
}

// ---- Phase 13.4 web content (server-side notes + events) ----

export interface WebNoteDto {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  updatedAt: number;
}

export interface WebEventDto {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
}

async function authed(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return await fetch(`${BACKEND}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  } catch {
    return null;
  }
}

export async function listNotes(): Promise<WebNoteDto[]> {
  const res = await authed('/v1/notes');
  if (!res?.ok) return [];
  return ((await res.json()) as { notes: WebNoteDto[] }).notes;
}

export async function saveNote(note: Omit<WebNoteDto, 'updatedAt'>): Promise<boolean> {
  const res = await authed('/v1/notes', { method: 'PUT', body: JSON.stringify(note) });
  return res?.ok ?? false;
}

export async function deleteNote(id: string): Promise<boolean> {
  const res = await authed(`/v1/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res?.ok ?? false;
}

export async function listEvents(fromIso: string, toIso: string): Promise<WebEventDto[]> {
  const res = await authed(`/v1/events?fromIso=${encodeURIComponent(fromIso)}&toIso=${encodeURIComponent(toIso)}`);
  if (!res?.ok) return [];
  return ((await res.json()) as { events: WebEventDto[] }).events;
}

export async function saveEvent(event: WebEventDto): Promise<boolean> {
  const res = await authed('/v1/events', { method: 'PUT', body: JSON.stringify(event) });
  return res?.ok ?? false;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const res = await authed(`/v1/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res?.ok ?? false;
}
