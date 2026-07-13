import React, { useEffect, useRef, useState } from 'react';
import { newId, STRINGS, type AgentEvent, type CardPayload, type VoiceState } from '@apollo/shared';
import { CardShell, CardView } from '../../components/cards/CardView';
import { CancelWindowBar } from '../../components/ConfirmBar';
import { enqueueTtsChunk, playEarcon, stopPlayback } from '../../lib/audioPlayer';

type OrbState = Extract<VoiceState, 'idle' | 'thinking' | 'speaking' | 'listening' | 'muted' | 'error'>;

interface PanelCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
}

const AUTO_DISMISS_MS = 8_000;

/** C18: live 24-bar waveform (2px bars, 3px gap, 32px tall) driven by rms. */
function Waveform({ rms }: { rms: number }): React.JSX.Element {
  const bars = Array.from({ length: 24 }, (_, i) => {
    const jitter = 0.5 + 0.5 * Math.abs(Math.sin(i * 2.399));
    return Math.max(2, Math.min(32, rms * 300 * jitter));
  });
  return (
    <div aria-label="Apollo is listening" style={{ display: 'flex', alignItems: 'center', gap: 3, height: 64, marginTop: 4 }}>
      {bars.map((h, i) => (
        <div key={i} style={{ width: 2, height: h, background: 'var(--accent)', borderRadius: 1, transition: 'height 80ms linear' }} />
      ))}
    </div>
  );
}

export function OrbApp(): React.JSX.Element {
  const [state, setState] = useState<OrbState>('idle');
  const [cards, setCards] = useState<PanelCard[]>([]);
  const [hovering, setHovering] = useState(false);
  const [caption, setCaption] = useState('');
  const [rms, setRms] = useState(0);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [cancelWindow, setCancelWindow] = useState<{ endsAt: number } | null>(null);
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
          setTurnId(e.turnId);
          break;
        case 'card':
          setCards((cs) => [...cs, { id: newId(), card: e.card, pinned: false }].slice(-6));
          break;
        case 'cancelWindow':
          setCancelWindow({ endsAt: Date.now() + e.ms });
          break;
        case 'done':
        case 'error':
          setState('idle');
          setCancelWindow(null);
          armDismiss();
          break;
        default:
          break;
      }
    });
    const offVoice = window.apollo.on('voice.state', ({ state: vs }) => {
      setState(vs as OrbState);
      if (vs === 'listening') void playEarcon('wake');
      else if (vs === 'error') void playEarcon('error');
      if (vs !== 'listening') setCaption('');
    });
    const offPartial = window.apollo.on('voice.partial', ({ transcript, rms }) => {
      setCaption(transcript);
      setRms(rms);
    });
    const offAudio = window.apollo.on('tts.audio', ({ data, last }) => enqueueTtsChunk(data, last));
    const offStop = window.apollo.on('tts.stop', () => stopPlayback());
    return () => {
      offAgent();
      offVoice();
      offPartial();
      offAudio();
      offStop();
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        {state === 'listening' ? (
          <Waveform rms={rms} />
        ) : (
          <div
            aria-label={`Apollo is ${state}`}
            style={{
              width: orbSize,
              height: orbSize,
              borderRadius: '50%',
              background: state === 'error' ? 'var(--danger)' : 'var(--accent)',
              opacity: active ? 1 : hovering ? 0.9 : 0.55,
              transition: 'all var(--dur) var(--ease)',
              marginTop: 4,
              animation: state === 'thinking' ? 'apollo-pulse 1.2s ease-in-out infinite' : state === 'speaking' ? 'apollo-spin 2.4s linear infinite' : 'none',
              border: state === 'speaking' ? '3px solid var(--accent-soft)' : 'none',
              borderTopColor: state === 'speaking' ? 'var(--surface)' : undefined,
            }}
          />
        )}
        {state === 'listening' && caption ? (
          <div
            style={{
              marginTop: 'var(--sp-2)',
              maxWidth: 200,
              fontSize: 'var(--fs-caption)',
              color: 'var(--text-2)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-ctl)',
              padding: 'var(--sp-1) var(--sp-2)',
              textAlign: 'right',
            }}
          >
            {caption}
          </div>
        ) : null}
      </div>
      <style>{`
        @keyframes apollo-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        @keyframes apollo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* card panel opens toward screen center (left of the orb) */}
      {cards.length > 0 || cancelWindow ? (
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
          {cancelWindow ? (
            <CancelWindowBar
              endsAt={cancelWindow.endsAt}
              onCancel={() => {
                if (turnId) void window.apollo.call('agent.cancel', { turnId });
                setCancelWindow(null);
              }}
            />
          ) : null}
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
