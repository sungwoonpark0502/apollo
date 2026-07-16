import React, { useEffect, useState } from 'react';
import { fmtDateIso, STRINGS, type CardPayload } from '@apollo/shared';
import { WeatherGlyph } from './WeatherGlyph';
import { sentenceToRow, stageDeepLink, stageRowCount, stageTitle } from '../lib/stage';

/**
 * E4 Response Stage presentation for voice answers (brief / newsList / weather /
 * eventList). Translucent surface, staggered row entrance, count-up temp, and a
 * best-effort accent bar on the row being spoken. Reduced-motion collapses to a
 * plain fade. Deep-links into the Workspace.
 */
export function StageCard({ card, spokenIndex }: { card: CardPayload; spokenIndex: number }): React.JSX.Element {
  const t = STRINGS.workspace.stage;
  const rows = stageRowCount(card);
  // Assume the common lead-in + one-sentence-per-row shape when total is unknown.
  const highlightRow = sentenceToRow(spokenIndex, rows, rows + 1);
  const title = stageTitle(card, t);
  const deepLink = stageDeepLink(card);

  const openInApollo = (): void => {
    if (deepLink) void window.apollo.call('workspace.open', deepLink);
  };

  return (
    <div className="apollo-stage" style={stageSurface}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-3)' }}>{title}</div>
        {deepLink ? (
          <button onClick={openInApollo} style={openBtn}>{t.openInApollo}</button>
        ) : null}
      </div>
      <StageBody card={card} highlightRow={highlightRow} />
    </div>
  );
}

function StageBody({ card, highlightRow }: { card: CardPayload; highlightRow: number | null }): React.JSX.Element {
  switch (card.kind) {
    case 'weather':
      return <StageWeather card={card} />;
    case 'newsList':
      return (
        <div>
          {card.items.map((it, i) => (
            <StageRow key={it.url} index={i} highlighted={highlightRow === i}>
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-1)', textDecoration: 'none', fontWeight: 500 }}>{it.title}</a>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{it.source}</div>
            </StageRow>
          ))}
        </div>
      );
    case 'eventList':
      return (
        <div>
          {card.events.map((e, i) => (
            <StageRow key={e.id} index={i} highlighted={highlightRow === i}>
              <span style={{ fontWeight: 500 }}>{e.title}</span>
            </StageRow>
          ))}
        </div>
      );
    case 'brief':
      return (
        <div>
          {card.sections.map((s, i) => (
            <StageRow key={i} index={i} highlighted={highlightRow === i}>
              {s.kind === 'text' ? s.body : <StageBody card={s} highlightRow={null} />}
            </StageRow>
          ))}
        </div>
      );
    default:
      return <></>;
  }
}

function StageWeather({ card }: { card: Extract<CardPayload, { kind: 'weather' }> }): React.JSX.Element {
  const [temp, setTemp] = useState(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    // count up over ~300ms (E4); reduced-motion jumps straight to the value.
    const target = card.now.tempF;
    const startAt = performance.now();
    let raf = 0;
    const tick = (t: number): void => {
      const p = reduced ? 1 : Math.min(1, (t - startAt) / 300);
      setTemp(Math.round(target * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [card.now.tempF, reduced]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <WeatherGlyph condition={card.now.condition} size={32} />
        <span style={{ fontSize: 40, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{temp}°</span>
        <span style={{ color: 'var(--text-2)' }}>{card.now.condition}</span>
      </div>
      {card.days.length > 0 ? (
        <div style={{ display: 'flex', gap: 'var(--sp-4)', marginTop: 'var(--sp-3)' }}>
          {card.days.slice(0, 4).map((d) => (
            <div key={d.dateIso} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                {fmtDateIso(d.dateIso, 'weekday-short')}
              </div>
              <WeatherGlyph condition={d.condition} size={18} />
              <div style={{ fontSize: 'var(--fs-caption)' }}>{d.hiF}° <span style={{ color: 'var(--text-3)' }}>{d.loF}°</span></div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StageRow({ index, highlighted, children }: { index: number; highlighted: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="apollo-stage-row"
      style={{
        padding: 'var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3)',
        borderLeft: highlighted ? '2px solid var(--accent)' : '2px solid transparent',
        animationDelay: `${index * 35}ms`,
        transition: 'border-color 120ms var(--ease)',
      }}
    >
      {children}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (): void => setReduced(mq.matches); // change handler, not a sync effect write
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const stageSurface: React.CSSProperties = {
  width: 480,
  maxHeight: '70vh',
  overflowY: 'auto',
  padding: 'var(--sp-5)',
  borderRadius: 'var(--radius-card)',
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
  boxShadow: 'var(--shadow-card)',
};
const openBtn: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)', color: 'var(--accent)',
  background: 'transparent', border: 'none', cursor: 'pointer',
};
