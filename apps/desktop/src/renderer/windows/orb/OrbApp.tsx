import React, { useEffect, useRef, useState } from 'react';
import { newId, STRINGS, type AgentEvent, type CardPayload, type VoiceState } from '@apollo/shared';
import { CardShell, CardView } from '../../components/cards/CardView';
import { StageCard } from '../../components/StageCard';
import { isStageCard } from '../../lib/stage';
import { CancelWindowBar } from '../../components/ConfirmBar';
import { enqueueTtsChunk, playEarcon, stopPlayback } from '../../lib/audioPlayer';

type OrbState = Extract<VoiceState, 'idle' | 'thinking' | 'speaking' | 'listening' | 'muted' | 'error'>;

interface PanelCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
  stage: boolean;
}

const AUTO_DISMISS_MS = 8_000;       // compact cards
const STAGE_DISMISS_MS = 12_000;     // E4 Stage cards linger longer

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
  const [spokenIndex, setSpokenIndex] = useState(-1);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveringRef = useRef(false);
  const voiceTurnRef = useRef(false); // E4: is the current turn voice-sourced?

  const cardsRef = useRef<PanelCard[]>([]);
  useEffect(() => {
    hoveringRef.current = hovering;
  }, [hovering]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    const armDismiss = (): void => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      const anyStage = cardsRef.current.some((c) => c.stage && !c.pinned);
      dismissTimer.current = setTimeout(() => {
        if (hoveringRef.current) {
          armDismiss(); // hovered: try again later
        } else {
          setCards((cs) => cs.filter((c) => c.pinned));
        }
      }, anyStage ? STAGE_DISMISS_MS : AUTO_DISMISS_MS);
    };

    const offAgent = window.apollo.on('agent.events', (e: AgentEvent) => {
      switch (e.type) {
        case 'turnStart':
          setState('thinking');
          setTurnId(e.turnId);
          voiceTurnRef.current = false; // reset; voice.state will flip it if this is a voice turn
          setSpokenIndex(-1);
          break;
        case 'card':
          setCards((cs) => [...cs, { id: newId(), card: e.card, pinned: false, stage: isStageCard(e.card, voiceTurnRef.current ? 'voice' : 'text') }].slice(-6));
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
      if (vs === 'listening' || vs === 'thinking' || vs === 'speaking') voiceTurnRef.current = true;
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
    const offSpoken = window.apollo.on('tts.spoken', ({ index }) => setSpokenIndex(index));
    return () => {
      offAgent();
      offVoice();
      offPartial();
      offAudio();
      offStop();
      offSpoken();
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
        @keyframes apollo-stage-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes apollo-row-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        .apollo-stage { animation: apollo-stage-in 160ms var(--ease) both; }
        .apollo-stage-row { animation: apollo-row-in 160ms var(--ease) both; }
        @media (prefers-reduced-motion: reduce) {
          /* E4: Stage collapses to a plain fade; row stagger + count-up disabled. */
          .apollo-stage { animation: apollo-stage-in 120ms linear both; }
          .apollo-stage-row { animation: none !important; }
          * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* card panel opens toward screen center (left of the orb); widens in Stage mode */}
      {cards.length > 0 || cancelWindow ? (
        <div
          style={{
            width: cards.some((c) => c.stage) ? 480 : 380,
            maxHeight: cards.some((c) => c.stage) ? '70vh' : '60vh',
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
              {c.stage ? (
                <StageCard card={c.card} spokenIndex={spokenIndex} />
              ) : (
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
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
