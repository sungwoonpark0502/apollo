import { create } from 'zustand';
import { newId, STRINGS, type AgentEvent, type CardPayload } from '@apollo/shared';

export interface ShownCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
}

export interface CancelWindow {
  confirmationId: string;
  turnId: string | null;
  endsAt: number;
}

export interface ConversationState {
  convId: string;
  turnId: string | null;
  streaming: boolean;
  reply: string;
  cards: ShownCard[];
  errorCopy: string | null;
  cancelWindow: CancelWindow | null;
  activity: string | null; // I5 tool-activity line while a tool runs
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

function freshConv(): Pick<ConversationState, 'convId' | 'turnId' | 'streaming' | 'reply' | 'cards' | 'errorCopy' | 'cancelWindow' | 'activity'> {
  return { convId: newId(), turnId: null, streaming: false, reply: '', cards: [], errorCopy: null, cancelWindow: null, activity: null };
}

export const useStore = create<ConversationState & Actions>((set) => ({
  ...freshConv(),
  inputHistory: [],

  beginTurn: () => set({ streaming: true, reply: '', errorCopy: null }),

  applyEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case 'turnStart':
          return { turnId: e.turnId, streaming: true, reply: '', errorCopy: null, activity: null };
        case 'token':
          return { reply: s.reply + e.text };
        case 'toolStart':
          return { activity: STRINGS.toolActivity(e.tool) };
        case 'toolResult':
          return { activity: null };
        case 'card':
          return { cards: [...s.cards, { id: newId(), card: e.card, pinned: false }] };
        case 'confirmRequest':
          return {}; // the confirm card arrives as its own card event
        case 'cancelWindow':
          return { cancelWindow: { confirmationId: e.confirmationId, turnId: s.turnId, endsAt: Date.now() + e.ms } };
        case 'done':
          return { streaming: false, cancelWindow: null, activity: null };
        case 'error':
          return { streaming: false, errorCopy: e.userMessage || null, activity: null };
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
