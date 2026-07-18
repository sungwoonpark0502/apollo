import AdmZip from 'adm-zip';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@apollo/shared';
import { openDb, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { createRepos, type Repos } from '../db/repos/index';
import { createSecrets } from '../security/secrets';
import { createSettingsRepo } from '../db/repos/misc';
import { buildIcs, exportZip, importZip, parseIcs } from './exportImport';

let db: Db;
let repos: Repos;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  repos = createRepos(db);
});

function seed(): void {
  repos.notes.save({ content: 'Grocery List\n\nMilk and eggs' });
  repos.events.create({ title: 'Standup', startTs: Date.parse('2026-07-14T09:30:00Z'), endTs: Date.parse('2026-07-14T10:00:00Z'), tz: 'America/Los_Angeles' });
  repos.todos.add({ content: 'buy milk' });
  repos.reminders.create({ text: 'call mom', dueTs: Date.parse('2026-07-14T21:00:00Z') });
  repos.memory.save({ category: 'person', fact: 'partner lives in Columbus' });
}

describe('export (H2)', () => {
  it('produces a zip with all expected members', () => {
    seed();
    const { buffer, counts } = exportZip(repos, defaultSettings(), { includeConversations: false });
    const zip = new AdmZip(buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.startsWith('notes/'))).toBe(true);
    expect(names).toContain('calendar.ics');
    expect(names).toContain('todos.json');
    expect(names).toContain('reminders.json');
    expect(names).toContain('facts.json');
    expect(names).toContain('settings.json');
    expect(names).not.toContain('conversations.jsonl');
    expect(counts).toMatchObject({ notes: 1, events: 1, todos: 1, reminders: 1, facts: 1, conversations: 0 });
  });

  it('SECRETS ABSENT: no stored API key or token appears anywhere in the export', () => {
    seed();
    // store real secrets through the secrets vault (xor codec stand-in)
    const settingsRepo = createSettingsRepo(db);
    const secrets = createSecrets({
      settings: settingsRepo,
      codec: { available: () => true, encrypt: (p) => Buffer.from(p).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString('utf8') },
      env: {},
    });
    secrets.set('anthropic', 'sk-ant-SUPERSECRET-TOKEN-123');
    secrets.set('deepgram', 'dg-SECRET-KEY-456');
    // J5.2: also seed a Google OAuth row and a gcal sync token — neither may leak.
    repos.oauth.upsert({ provider: 'google', address: 'me@gmail.com', tokenRef: 'GCAL-REFRESH-TOKEN-XYZ' });
    repos.sync.setToken('google:primary', 'GCAL-SYNC-TOKEN-SECRET', Date.now());

    const { buffer } = exportZip(repos, defaultSettings(), { includeConversations: true });
    const zip = new AdmZip(buffer);
    const forbidden = ['sk-ant-SUPERSECRET-TOKEN-123', 'dg-SECRET-KEY-456', 'SUPERSECRET', 'GCAL-REFRESH-TOKEN-XYZ', 'GCAL-SYNC-TOKEN-SECRET'];
    for (const entry of zip.getEntries()) {
      const text = entry.getData().toString('utf8');
      for (const needle of forbidden) expect(text, `${entry.entryName} leaked ${needle}`).not.toContain(needle);
      expect(text.toLowerCase()).not.toContain('secret.anthropic'); // no keymeta/store keys either
      expect(text.toLowerCase()).not.toContain('token_ref');
      expect(text.toLowerCase()).not.toContain('sync_token');
    }
    // The export set is a fixed allowlist of non-sensitive artifacts (no oauth/sync/usage tables).
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).not.toContain('oauth_accounts.json');
    expect(names).not.toContain('usage_log.json'); // usage_log is telemetry (aggregate counts), never exported — documented in DECISIONS
    expect(names).not.toContain('sync_state.json');
  });

  it('includes conversations.jsonl only when asked', () => {
    repos.conversations.ensure('c1');
    repos.conversations.addMessage({ convId: 'c1', role: 'user', content: 'hi there' });
    const { buffer, counts } = exportZip(repos, defaultSettings(), { includeConversations: true });
    expect(counts.conversations).toBe(1);
    expect(new AdmZip(buffer).getEntry('conversations.jsonl')).toBeTruthy();
  });
});

describe('ICS round-trip (H2)', () => {
  it('builds and re-parses events including RRULE and EXDATE', () => {
    const ev = repos.events.create({
      title: 'Weekly sync, room 2', startTs: Date.parse('2026-07-13T17:00:00Z'), endTs: Date.parse('2026-07-13T17:30:00Z'),
      tz: 'America/Los_Angeles', rrule: 'FREQ=WEEKLY;BYDAY=MO', location: 'HQ',
    });
    repos.events.addExdate(ev.id, '2026-07-20');
    const ics = buildIcs(repos.events.allActive());
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(ics).toContain('EXDATE;VALUE=DATE:20260720');
    const parsed = parseIcs(ics);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe(ev.id);
    expect(parsed[0]!.title).toBe('Weekly sync, room 2');
    expect(parsed[0]!.rrule).toContain('FREQ=WEEKLY');
    expect(parsed[0]!.exdates).toContain('2026-07-20');
  });
});

describe('import id-merge (H2)', () => {
  it('re-importing into the same DB skips all existing ids (no duplicates)', () => {
    seed();
    const { buffer } = exportZip(repos, defaultSettings(), { includeConversations: false });
    const counts = importZip(repos, buffer);
    expect(counts).toEqual({ notes: 0, events: 0, todos: 0, reminders: 0, facts: 0 });
    expect(repos.todos.allActive()).toHaveLength(1); // unchanged
  });

  it('imports into an empty DB and reports per-kind counts', () => {
    seed();
    const { buffer } = exportZip(repos, defaultSettings(), { includeConversations: false });

    const db2 = openDb(':memory:');
    migrate(db2);
    const repos2 = createRepos(db2);
    const counts = importZip(repos2, buffer);
    expect(counts).toEqual({ notes: 1, events: 1, todos: 1, reminders: 1, facts: 1 });
    expect(repos2.notes.allFull()).toHaveLength(1);
    expect(repos2.events.allActive()[0]!.title).toBe('Standup');
    db2.close();
  });
});
