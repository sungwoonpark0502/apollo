import React, { useEffect, useRef, useState } from 'react';
import { newId, STRINGS, type AgentEvent, type CardPayload, type VoiceState } from '@apollo/shared';
import { CardShell, CardView } from '../../components/cards/CardView';

type OrbState = Extract<VoiceState, 'idle' | 'thinking' | 'speaking' | 'listening' | 'muted' | 'error'>;

interface PanelCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
}

const AUTO_DISMISS_MS = 8_000;

export function OrbApp(): React.JSX.Element {
  const [state, setState] = useState<OrbState>('idle');
  const [cards, setCards] = useState<PanelCard[]>([]);
  const [hovering, setHovering] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveringRef = useRef(false);

  useEffect(() => {
    hoveringRef.current = hovering;
  }, [hovering]);

  useEffect(() => {
    const armDismiss = (): void => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        if (hoveringRef.current) {
          armDismiss(); // hovered: try again later
        } else {
          setCards((cs) => cs.filter((c) => c.pinned));
        }
      }, AUTO_DISMISS_MS);
    };

    const offAgent = window.apollo.on('agent.events', (e: AgentEvent) => {
      switch (e.type) {
        case 'turnStart':
          setState('thinking');
          break;
        case 'card':
          setCards((cs) => [...cs, { id: newId(), card: e.card, pinned: false }].slice(-6));
          break;
        case 'done':
        case 'error':
          setState('idle');
          armDismiss();
          break;
        default:
          break;
      }
    });
    const offVoice = window.apollo.on('voice.state', ({ state: vs }) => setState(vs as OrbState));
    return () => {
      offAgent();
      offVoice();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const active = state !== 'idle' || cards.length > 0;
  const orbSize = active ? 64 : 14;

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'flex-start', height: '100vh', padding: 'var(--sp-2)' }}
    >
      {/* orb, docked toward the screen edge (right) */}
      <div
        aria-label={`Apollo is ${state}`}
        style={{
          width: orbSize,
          height: orbSize,
          borderRadius: '50%',
          background: state === 'error' ? 'var(--danger)' : 'var(--accent)',
          opacity: active ? 1 : hovering ? 0.9 : 0.55,
          transition: 'all var(--dur) var(--ease)',
          flexShrink: 0,
          marginTop: 4,
          animation: state === 'thinking' ? 'apollo-pulse 1.2s ease-in-out infinite' : state === 'speaking' ? 'apollo-spin 2.4s linear infinite' : 'none',
          border: state === 'speaking' ? '3px solid var(--accent-soft)' : 'none',
          borderTopColor: state === 'speaking' ? 'var(--surface)' : undefined,
        }}
      />
      <style>{`
        @keyframes apollo-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        @keyframes apollo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* card panel opens toward screen center (left of the orb) */}
      {cards.length > 0 ? (
        <div
          style={{
            width: 380,
            maxHeight: '60vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-3)',
            marginRight: 'var(--sp-3)',
          }}
        >
          {cards.map((c) => (
            <div key={c.id} style={{ position: 'relative' }}>
              <CardShell>
                <button
                  aria-label={c.pinned ? STRINGS.cards.unpin : STRINGS.cards.pin}
                  onClick={() => setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)))}
                  style={{
                    position: 'absolute',
                    top: 'var(--sp-2)',
                    right: 'var(--sp-2)',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-caption)',
                    color: c.pinned ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  ⦿
                </button>
                <CardView card={c.card} />
              </CardShell>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
