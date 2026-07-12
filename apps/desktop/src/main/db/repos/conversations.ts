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
  };
}

export type ConversationsRepo = ReturnType<typeof createConversationsRepo>;
