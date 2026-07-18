import { newId } from '@apollo/shared';

/**
 * H5 conversation lifecycle. Main owns the active conversation id, shared across
 * voice and the Chat tab (one-brain). A new conversation begins when the previous
 * activity is older than 30 minutes, on setActive, or on explicit user request.
 */
const ROTATE_AFTER_MS = 30 * 60_000;

export interface ConversationManagerDeps {
  now?: () => number;
  rotateAfterMs?: number;
  onRotate?: (convId: string) => void;
}

export function createConversationManager(deps: ConversationManagerDeps = {}) {
  const now = deps.now ?? Date.now;
  const rotateAfter = deps.rotateAfterMs ?? ROTATE_AFTER_MS;
  let activeId = newId();
  let lastActivity = 0; // 0 = no turn yet; the first turn never rotates

  return {
    current(): string {
      return activeId;
    },
    /** Call at the start of each user turn; rotates to a fresh conversation if stale. */
    forTurn(): string {
      const t = now();
      if (lastActivity !== 0 && t - lastActivity > rotateAfter) {
        activeId = newId();
        deps.onRotate?.(activeId);
      }
      lastActivity = t;
      return activeId;
    },
    /** Explicit "new conversation". */
    startNew(): string {
      activeId = newId();
      lastActivity = now();
      deps.onRotate?.(activeId);
      return activeId;
    },
    /** conversations.setActive: continue an existing conversation. */
    setActive(id: string): void {
      activeId = id;
      lastActivity = now();
    },
  };
}

export type ConversationManager = ReturnType<typeof createConversationManager>;
