import { newId, nowMs } from '@apollo/shared';
import { type Db } from '../connection';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface MessageRow { id: string; convId: string; role: MessageRole; content: string; ts: number }

interface Raw { id: string; conv_id: string; role: MessageRole; content: string; ts: number }

export function createConversationsRepo(db: Db) {
  return {
    /** Creates the conversation row if it does not exist. */
    ensure(convId: string): void {
      db.prepare('INSERT OR IGNORE INTO conversations(id, started_at) VALUES (?,?)').run(convId, nowMs());
    },
    addMessage(input: { convId: string; role: MessageRole; content: string; ts?: number }): MessageRow {
      const id = newId();
      const ts = input.ts ?? nowMs();
      db.prepare('INSERT INTO messages(id,conv_id,role,content,ts) VALUES (?,?,?,?,?)').run(id, input.convId, input.role, input.content, ts);
      return { id, convId: input.convId, role: input.role, content: input.content, ts };
    },
    /** Last `n` messages in chronological order. */
    lastMessages(convId: string, n = 20): MessageRow[] {
      const rows = db
        .prepare('SELECT * FROM messages WHERE conv_id=? ORDER BY ts DESC, id DESC LIMIT ?')
        .all(convId, n) as Raw[];
      return rows
        .reverse()
        .map((r) => ({ id: r.id, convId: r.conv_id, role: r.role, content: r.content, ts: r.ts }));
    },
    /** All messages across conversations, newest first (indexer rebuild). Excludes tool rows. */
    recentAll(n = 5000): MessageRow[] {
      return (db.prepare("SELECT * FROM messages WHERE role IN ('user','assistant') ORDER BY ts DESC LIMIT ?").all(n) as Raw[]).map((r) => ({
        id: r.id, convId: r.conv_id, role: r.role, content: r.content, ts: r.ts,
      }));
    },

    /** K2 Chat sidebar: summaries (custom title wins, else first user message), pinned first, newest activity first. */
    listSummaries(limit = 50): Array<{ id: string; title: string; startedAt: number; lastTs: number; messageCount: number; pinned: boolean }> {
      const convs = db.prepare('SELECT id, started_at, title, pinned FROM conversations ORDER BY started_at DESC LIMIT ?').all(limit) as Array<{ id: string; started_at: number; title: string | null; pinned: number }>;
      const out: Array<{ id: string; title: string; startedAt: number; lastTs: number; messageCount: number; pinned: boolean }> = [];
      for (const c of convs) {
        const agg = db.prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM messages WHERE conv_id=? AND role IN ('user','assistant')").get(c.id) as { n: number; last: number | null };
        if (agg.n === 0) continue;
        const firstUser = db.prepare("SELECT content FROM messages WHERE conv_id=? AND role='user' ORDER BY ts LIMIT 1").get(c.id) as { content: string } | undefined;
        const derived = (firstUser?.content ?? 'Conversation').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversation';
        out.push({ id: c.id, title: c.title?.trim() || derived, startedAt: c.started_at, lastTs: agg.last ?? c.started_at, messageCount: agg.n, pinned: c.pinned === 1 });
      }
      return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastTs - a.lastTs);
    },

    /** K2 rename: custom title (empty string reverts to the derived title). */
    rename(convId: string, title: string): void {
      db.prepare('UPDATE conversations SET title=? WHERE id=?').run(title.trim() || null, convId);
    },

    /** K2 pin: pinned conversations sort first in the sidebar. */
    setPinned(convId: string, pinned: boolean): void {
      db.prepare('UPDATE conversations SET pinned=? WHERE id=?').run(pinned ? 1 : 0, convId);
    },

    /** All user/assistant messages of one conversation, chronological (Chat thread; ids drive K1 message actions). */
    messagesOf(convId: string): Array<{ id: string; role: MessageRole; content: string; ts: number }> {
      return (db.prepare("SELECT id, role, content, ts FROM messages WHERE conv_id=? AND role IN ('user','assistant') ORDER BY ts, id").all(convId) as Array<{ id: string; role: MessageRole; content: string; ts: number }>);
    },

    /**
     * K1 regenerate/editAndResend: delete `messageId` and everything after it in
     * the conversation (all roles, tool rows included). Returns the deleted
     * user/assistant ids so the caller can purge their index chunks.
     */
    deleteFromMessage(convId: string, messageId: string): string[] {
      const anchor = db.prepare('SELECT ts, id FROM messages WHERE conv_id=? AND id=?').get(convId, messageId) as { ts: number; id: string } | undefined;
      if (!anchor) return [];
      const doomed = db
        .prepare("SELECT id FROM messages WHERE conv_id=? AND (ts > ? OR (ts = ? AND id >= ?)) AND role IN ('user','assistant')")
        .all(convId, anchor.ts, anchor.ts, anchor.id) as Array<{ id: string }>;
      db.prepare('DELETE FROM messages WHERE conv_id=? AND (ts > ? OR (ts = ? AND id >= ?))').run(convId, anchor.ts, anchor.ts, anchor.id);
      return doomed.map((r) => r.id);
    },

    /** H5 delete: remove a conversation and its messages (chunk purge handled by the caller). */
    deleteConversation(convId: string): void {
      db.prepare('DELETE FROM messages WHERE conv_id=?').run(convId);
      db.prepare('DELETE FROM conversations WHERE id=?').run(convId);
    },
  };
}

export type ConversationsRepo = ReturnType<typeof createConversationsRepo>;
