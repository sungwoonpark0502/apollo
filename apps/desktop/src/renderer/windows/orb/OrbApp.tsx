import React, { useEffect, useRef, useState } from 'react';
import { newId, STRINGS, type AgentEvent, type CardPayload, type SuggestionDTO, type VoiceState } from '@apollo/shared';
import { CardShell, CardView } from '../../components/cards/CardView';
import { Icon } from '../../components/Icon';
import { StageCard } from '../../components/StageCard';
import { NudgeCard, NudgeGroupCard } from '../../components/NudgeCard';
import { RingingCard, type RingingAlert } from '../../components/RingingCard';
import { isStageCard } from '../../lib/stage';
import { fireControl } from '../../lib/controlDispatch';
import { CancelWindowBar } from '../../components/ConfirmBar';
import { enqueueTtsChunk, playbackProgress, playEarcon, replayFromStart, setEarconVolume, skipSentence, stopPlayback } from '../../lib/audioPlayer';
import { useFormatInit } from '../../lib/useLive';

type OrbState = Extract<VoiceState, 'idle' | 'thinking' | 'speaking' | 'listening' | 'followup' | 'muted' | 'error'>;

interface PanelCard {
  id: string;
  card: CardPayload;
  pinned: boolean;
  stage: boolean;
}

interface NudgePanel {
  id: string;               // panel key
  suggestions: SuggestionDTO[]; // 1 = single nudge; >1 = grouped digest
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
  useFormatInit();
  const [state, setState] = useState<OrbState>('idle');
  const [cards, setCards] = useState<PanelCard[]>([]);
  const [hovering, setHovering] = useState(false);
  const [caption, setCaption] = useState('');
  const [rms, setRms] = useState(0);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null); // K3: deep-link "Open in chat"
  // I5 "sentence i of n", shown only for long replies (>6 sentences).
  const [progress, setProgress] = useState<{ index: number; total: number }>({ index: 0, total: 0 });
  const [orbMenu, setOrbMenu] = useState(false); // K3 right-click menu
  const [cancelWindow, setCancelWindow] = useState<{ endsAt: number } | null>(null);
  const [spokenIndex, setSpokenIndex] = useState(-1);
  const [activity, setActivity] = useState<string | null>(null); // I5 tool-activity line
  const [nudges, setNudges] = useState<NudgePanel[]>([]);
  const [ringing, setRinging] = useState<RingingAlert[]>([]);
  const [earconVol, setEarconVol] = useState(0.7);
  const [nudgeDot, setNudgeDot] = useState(false); // F3: small accent dot on the idle orb
  const [firstNudgeNote, setFirstNudgeNote] = useState(false); // I6 one-time proactivity explainer
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
          setConvId(e.convId); // the conversation this turn belongs to (K3 deep link)
          voiceTurnRef.current = false; // reset; voice.state will flip it if this is a voice turn
          setSpokenIndex(-1);
          setActivity(null);
          break;
        case 'toolStart':
          setActivity(STRINGS.toolActivity(e.tool)); // friendly label, never the raw tool name
          break;
        case 'toolResult':
          setActivity(null);
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
          setActivity(null);
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
    const offAudio = window.apollo.on('tts.audio', ({ data, last }) => {
      enqueueTtsChunk(data, last);
      // Decoding is async, so read the count on the next tick rather than now.
      setTimeout(() => setProgress(playbackProgress()), 0);
    });
    const offStop = window.apollo.on('tts.stop', () => stopPlayback());
    const offSpoken = window.apollo.on('tts.spoken', ({ index }) => setSpokenIndex(index));
    const offNudge = window.apollo.on('suggestion.show', ({ suggestion, group, silent, firstNudge }) => {
      const list = group ?? (suggestion ? [suggestion] : []);
      if (list.length === 0) return;
      if (firstNudge) setFirstNudgeNote(true); // I6 one-time proactivity explainer
      if (!silent) void playEarcon('nudge'); // silent DND delivery skips the chime
      setNudges((ns) => [...ns, { id: newId(), suggestions: list }].slice(-4));
      setNudgeDot(true);
      // auto-dismiss the nudge panel after 20s unless hovered (main records 'expired')
      setTimeout(() => {
        if (!hoveringRef.current) setNudges((ns) => ns.slice(1));
      }, 20_000);
    });
    const offRing = window.apollo.on('alert.ringing', (a) => {
      setRinging((rs) => [...rs.filter((r) => r.id !== a.id), a]);
    });
    const offRingStop = window.apollo.on('alert.stop', ({ id }) => {
      setRinging((rs) => rs.filter((r) => r.id !== id));
    });
    void window.apollo.call('settings.get', {}).then((s) => { setEarconVolume(s.voice.earconVolume); setEarconVol(s.voice.earconVolume); });
    const offSettings = window.apollo.on('settings.changed', (s) => { setEarconVolume(s.voice.earconVolume); setEarconVol(s.voice.earconVolume); });
    return () => {
      offAgent();
      offVoice();
      offPartial();
      offAudio();
      offStop();
      offSpoken();
      offNudge();
      offRing();
      offRingStop();
      offSettings();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const nudgeAction = (suggestionId: string, actionId: string): void => {
    void fireControl('nudge.action', { suggestionId, actionId });
    // drop any panel that only contained this suggestion; clear the dot when none remain
    setNudges((ns) => {
      const next = ns
        .map((p) => ({ ...p, suggestions: p.suggestions.filter((s) => s.id !== suggestionId) }))
        .filter((p) => p.suggestions.length > 0);
      if (next.length === 0) setNudgeDot(false);
      return next;
    });
  };

  const active = state !== 'idle' || cards.length > 0 || nudges.length > 0;
  const orbSize = active ? 64 : 14;

  // H9 a11y: announce state transitions + ringing to screen readers.
  const announcement =
    ringing.length > 0
      ? STRINGS.alerts.ariaRinging(ringing[ringing.length - 1]!.label ?? ringing[ringing.length - 1]!.kind)
      : STRINGS.a11y.voiceState[state] ?? '';

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'flex-start', height: '100vh', padding: 'var(--sp-2)' }}
    >
      <div
        aria-live="polite"
        role="status"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
      >
        {announcement}
      </div>
      {/* orb, docked toward the screen edge (right) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        {orbMenu ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 'var(--sp-1)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
            <button
              onClick={() => { setOrbMenu(false); void fireControl('orb.menu.openChat', { convId }); }}
              style={{ border: 'none', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', padding: 'var(--sp-1) var(--sp-3)', textAlign: 'left' }}
            >
              {STRINGS.orbControls.openChat}
            </button>
            <button
              onClick={() => { setOrbMenu(false); void fireControl('orb.menu.openApollo'); }}
              style={{ border: 'none', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)', padding: 'var(--sp-1) var(--sp-3)', textAlign: 'left' }}
            >
              {STRINGS.orbControls.openApollo}
            </button>
          </div>
        ) : null}
        {state === 'listening' ? (
          <Waveform rms={rms} />
        ) : (
          <div style={{ position: 'relative', marginTop: 4 }} onContextMenu={(e) => { e.preventDefault(); setOrbMenu((v) => !v); }}>
            <div
              aria-label={`Apollo is ${state}`}
              style={{
                width: orbSize,
                height: orbSize,
                borderRadius: '50%',
                background: state === 'error' ? 'var(--danger)' : 'var(--accent)',
                opacity: active ? 1 : hovering ? 0.9 : 0.55,
                transition: 'all var(--dur) var(--ease)',
                animation:
                  state === 'thinking'
                    ? 'apollo-pulse 1.2s ease-in-out infinite'
                    : state === 'speaking'
                      ? 'apollo-spin 2.4s linear infinite'
                      : state === 'followup'
                        ? 'apollo-pulse 2.2s ease-in-out infinite' // H5 thin breathing ring
                        : nudgeDot && state === 'idle' && nudges.length === 0
                          ? 'apollo-pulse 1.6s ease-in-out infinite'
                          : 'none',
                border: state === 'speaking' ? '3px solid var(--accent-soft)' : state === 'followup' ? '2px solid var(--accent-soft)' : 'none',
                borderTopColor: state === 'speaking' ? 'var(--surface)' : undefined,
              }}
            />
            {nudgeDot ? (
              <span
                aria-label={STRINGS.a11y.nudge}
                style={{ position: 'absolute', top: -1, right: -1, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }}
              />
            ) : null}
          </div>
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
        {/* I5 tool-activity + interruptible thinking */}
        {state === 'thinking' ? (
          <div style={pillBar}>
            <span style={{ color: 'var(--text-2)' }}>{activity ?? STRINGS.a11y.voiceState.thinking}</span>
            <button onClick={() => { void fireControl('orb.thinking.cancel', { turnId }); setState('idle'); }} style={pillBtn}>
              {STRINGS.orbControls.cancel}
            </button>
          </div>
        ) : null}
        {/* I5 streaming TTS controls: Stop, Skip sentence, Replay from start.
            Skip and Replay act on the local playback queue, so neither costs an
            LLM turn or a re-synthesis. */}
        {state === 'speaking' ? (
          <div style={pillBar}>
            <button onClick={() => { stopPlayback(); void fireControl('orb.tts.stop'); }} style={pillBtn}>{STRINGS.orbControls.stop}</button>
            <button onClick={() => { skipSentence(); setProgress(playbackProgress()); }} style={pillBtn}>{STRINGS.orbControls.skip}</button>
            <button onClick={() => { replayFromStart(); setProgress(playbackProgress()); }} style={pillBtn}>{STRINGS.orbControls.replay}</button>
            {progress.total > 6 ? (
              <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>
                {STRINGS.orbControls.progress(progress.index, progress.total)}
              </span>
            ) : null}
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

      {/* H6 ringing overlays (Stage width): timers + alarms, above everything else */}
      {ringing.length > 0 ? (
        <div style={{ width: 480, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginRight: 'var(--sp-3)' }}>
          {ringing.map((a) => (
            <CardShell key={a.id}>
              <RingingCard
                alert={a}
                earconVolume={earconVol}
                onAction={(id, action, snoozeMin) => {
                  setRinging((rs) => rs.filter((r) => r.id !== id));
                  const control = action === 'snooze' ? 'ringing.snooze' : action === 'complete' ? 'ringing.complete' : 'ringing.dismiss';
                  void fireControl(control, { alert: { kind: a.kind, id }, ...(snoozeMin ? { snoozeMin } : {}) });
                }}
              />
            </CardShell>
          ))}
        </div>
      ) : null}

      {/* proactive nudge panels (F3): quiet, dismissible, above the reply cards */}
      {nudges.length > 0 ? (
        <div style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginRight: 'var(--sp-3)' }}>
          {firstNudgeNote ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
              <span style={{ flex: 1 }}>{STRINGS.nudges.firstNudgeExplainer}</span>
              <button onClick={() => setFirstNudgeNote(false)} aria-label="Dismiss" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}><Icon name="close" size={13} /></button>
            </div>
          ) : null}
          {nudges.map((p) => (
            <CardShell key={p.id}>
              {p.suggestions.length === 1 ? (
                <NudgeCard suggestion={p.suggestions[0]!} onAction={nudgeAction} />
              ) : (
                <NudgeGroupCard suggestions={p.suggestions} onAction={nudgeAction} />
              )}
            </CardShell>
          ))}
        </div>
      ) : null}

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
                void fireControl('confirm.cancelWindow', { turnId });
                setCancelWindow(null);
              }}
            />
          ) : null}
          {cards.map((c) => (
            <div key={c.id} style={{ position: 'relative' }}>
              {c.stage ? (
                <div style={{ position: 'relative' }}>
                  <StageCard card={c.card} spokenIndex={spokenIndex} />
                  <OpenInChatButton convId={convId} right={30} />
                </div>
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
                      display: 'flex',
                      color: c.pinned ? 'var(--accent)' : 'var(--text-3)',
                    }}
                  >
                    <Icon name="pin" size={14} filled={c.pinned} />
                  </button>
                  <OpenInChatButton convId={convId} right={30} />
                  <CardView card={c.card} convId={convId} />
                </CardShell>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** K3: continue a voice answer by typing — deep-links to the turn's conversation. */
function OpenInChatButton({ convId, right }: { convId: string | null; right: number }): React.JSX.Element | null {
  if (!convId) return null;
  return (
    <button
      aria-label={STRINGS.orbControls.openInChat}
      title={STRINGS.orbControls.openInChat}
      onClick={() => void fireControl('card.openInChat', { convId })}
      style={{
        position: 'absolute',
        top: 'var(--sp-2)',
        right,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 'var(--fs-caption)',
        color: 'var(--text-3)',
        zIndex: 2,
      }}
    >
      ✻
    </button>
  );
}

const pillBar: React.CSSProperties = {
  marginTop: 'var(--sp-2)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  maxWidth: 220,
  fontSize: 'var(--fs-caption)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-1) var(--sp-2)',
};
const pillBtn: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-1)',
  borderRadius: 'var(--radius-ctl)',
  padding: '1px var(--sp-2)',
  cursor: 'pointer',
  fontSize: 'var(--fs-caption)',
  fontFamily: 'var(--font-sans)',
};
