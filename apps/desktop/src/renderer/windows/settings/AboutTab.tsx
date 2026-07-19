import React, { useState } from 'react';
import { STRINGS } from '@apollo/shared';
import { DiagnosticsTab } from './DiagnosticsTab';

const APP_VERSION = '0.1.0'; // matches package.json / electron-builder

/**
 * E7 About tab: version, check-for-updates, licenses, logs link.
 * L5: Diagnostics is no longer a top-level tab — it lives here as a collapsed
 * "Advanced" section so a normal user is never confronted with perf spans and
 * adapter states, while support can still reach them.
 */
export function AboutTab(): React.JSX.Element {
  const a = STRINGS.settings.about;
  const [status, setStatus] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const check = (): void => {
    setStatus(a.checking);
    void window.apollo.call('update.check', {}).then((r) => {
      if (r.status === 'available' && r.version) setStatus(a.updateAvailable(r.version));
      else if (r.status === 'none') setStatus(a.upToDate);
      else if (r.status === 'checking') setStatus(a.checking);
      else setStatus(a.updatesDisabled);
    });
  };

  return (
    <div style={{ maxWidth: 460 }}>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-2)' }}>{a.title}</h2>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', marginBottom: 'var(--sp-4)' }}>{a.version(APP_VERSION)}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <button onClick={check} style={btn}>{a.checkUpdates}</button>
        {status ? <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{status}</span> : null}
      </div>

      <button onClick={() => void window.apollo.call('privacy.get', {})} style={{ ...linkBtn, display: 'block', marginBottom: 'var(--sp-2)' }}>
        {a.licenses}
      </button>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', lineHeight: 1.6 }}>
        Electron, React, zod, better-sqlite3, luxon, rrule, TipTap, @anthropic-ai/sdk, @deepgram/sdk,
        onnxruntime-node, @picovoice/porcupine-node, msedge-tts, rss-parser, googleapis, dompurify, pino,
        fastify, jose, fast-glob, uuidv7 — each under its respective open-source license.
      </div>

      <div style={{ marginTop: 'var(--sp-5)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
        <button onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen} style={{ ...linkBtn, fontSize: 'var(--fs-caption)' }}>
          {advancedOpen ? '▾' : '▸'} {a.advanced}
        </button>
        {advancedOpen ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <DiagnosticsTab />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)', padding: 0,
};
