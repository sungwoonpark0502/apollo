import { create } from 'zustand';
import { newId, type AgentEvent, type CardPayload } from '@apollo/shared';

export interface ShownCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
}

export interface ConversationState {
  convId: string;
  turnId: string | null;
  streaming: boolean;
  reply: string;
  cards: ShownCard[];
  errorCopy: string | null;
  inputHistory: string[];
}

interface Actions {
  applyEvent(e: AgentEvent): void;
  beginTurn(): void;
  pushHistory(text: string): void;
  togglePin(cardId: string): void;
  dismissCards(): void;
  reset(): void;
}

function freshConv(): Pick<ConversationState, 'convId' | 'turnId' | 'streaming' | 'reply' | 'cards' | 'errorCopy'> {
  return { convId: newId(), turnId: null, streaming: false, reply: '', cards: [], errorCopy: null };
}

export const useStore = create<ConversationState & Actions>((set) => ({
  ...freshConv(),
  inputHistory: [],

  beginTurn: () => set({ streaming: true, reply: '', errorCopy: null }),

  applyEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case 'turnStart':
          return { turnId: e.turnId, streaming: true, reply: '', errorCopy: null };
        case 'token':
          return { reply: s.reply + e.text };
        case 'card':
          return { cards: [...s.cards, { id: newId(), card: e.card, pinned: false }] };
        case 'confirmRequest':
          return {}; // the confirm card arrives as its own card event
        case 'done':
          return { streaming: false };
        case 'error':
          return { streaming: false, errorCopy: e.userMessage || null };
        default:
          return {};
      }
    }),

  pushHistory: (text) => set((s) => ({ inputHistory: [...s.inputHistory.filter((t) => t !== text), text].slice(-50) })),

  togglePin: (cardId) =>
    set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? { ...c, pinned: !c.pinned } : c)) })),

  dismissCards: () => set((s) => ({ cards: s.cards.filter((c) => c.pinned) })),

  reset: () => set({ ...freshConv() }),
}));
