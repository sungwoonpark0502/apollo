import { type Repos } from '../db/repos/index';

/**
 * PART K message actions (K1/K5): regenerate and edit-and-resend rewrite the
 * conversation tail. Both truncate the thread at a message, purge the removed
 * messages' index chunks (and vectors) so recall can never surface dropped
 * turns, then re-dispatch through the one-brain agent path.
 */
export interface ChatActionDeps {
  repos: Pick<Repos, 'conversations' | 'chunks'>;
  /** Dispatches through the identical orchestrator path as voice/chat. */
  dispatch: (input: { text: string; convId: string }) => { turnId: string };
}

export function createChatActions(deps: ChatActionDeps) {
  function purgeMessages(ids: string[]): void {
    for (const id of ids) deps.repos.chunks.removeForRef('message', id);
  }

  return {
    /**
     * K1 chat.regenerate: `messageId` is the assistant message to drop. Deletes
     * it (and anything after), purges its chunks, and re-runs the closest user
     * message before it.
     */
    regenerate(convId: string, messageId: string): { turnId: string } {
      const messages = deps.repos.conversations.messagesOf(convId);
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx < 0) throw new Error('message not found');
      const lastUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!lastUser) throw new Error('no user message to regenerate from');
      purgeMessages(deps.repos.conversations.deleteFromMessage(convId, messageId));
      return deps.dispatch({ text: lastUser.content, convId });
    },

    /**
     * K1 chat.editAndResend: `messageId` is the user message being edited.
     * Truncates the thread from that message on (discarding subsequent turns),
     * purges orphaned chunks, and resends the new text.
     */
    editAndResend(convId: string, messageId: string, newText: string): { turnId: string } {
      const messages = deps.repos.conversations.messagesOf(convId);
      const target = messages.find((m) => m.id === messageId);
      if (!target) throw new Error('message not found');
      if (target.role !== 'user') throw new Error('only user messages can be edited');
      purgeMessages(deps.repos.conversations.deleteFromMessage(convId, messageId));
      return deps.dispatch({ text: newText, convId });
    },
  };
}

export type ChatActions = ReturnType<typeof createChatActions>;
