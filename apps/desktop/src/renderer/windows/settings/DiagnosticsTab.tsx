import React, { useCallback, useEffect, useState } from 'react';
import { STRINGS } from '@apollo/shared';

interface Diag {
  perf: Array<{ name: string; count: number; p50: number; p95: number }>;
  adapters: { stt: string; tts: string; wake: string; llm: string; embedder: string };
  logTail: string[];
  indexQueueDepth: number;
}
interface Usage { today: Array<{ provider: string; metric: string; amount: number }>; month: Array<{ provider: string; metric: string; amount: number }> }

export function DiagnosticsTab(): React.JSX.Element {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void window.apollo.call('diagnostics.get', {}).then(setDiag);
    void window.apollo.call('usage.summary', {}).then(setUsage);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const copy = (): void => {
    if (!diag) return;
    const text = JSON.stringify({ perf: diag.perf, adapters: diag.adapters }, null, 2);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.diagnostics}</h2>

      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.diagnostics.perf}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-caption)' }}>
          <thead>
            <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
              <th style={cell}>span</th>
              <th style={cell}>count</th>
              <th style={cell}>p50</th>
              <th style={cell}>p95</th>
            </tr>
          </thead>
          <tbody>
            {(diag?.perf ?? []).map((r) => (
              <tr key={r.name}>
                <td style={cell}>{r.name}</td>
                <td style={cell}>{r.count}</td>
                <td style={cell}>{r.p50}</td>
                <td style={cell}>{r.p95}</td>
              </tr>
            ))}
            {diag && diag.perf.length === 0 ? (
              <tr>
                <td style={{ ...cell, color: 'var(--text-3)' }} colSpan={4}>
                  No spans recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.diagnostics.adapters}</h3>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
          {diag
            ? Object.entries(diag.adapters).map(([k, v]) => (
                <span key={k}>
                  <span style={{ color: 'var(--text-3)' }}>{k}:</span> {v}
                </span>
              ))
            : null}
        </div>
      </section>

      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={sectionTitle}>{STRINGS.usage.panelTitle}</h3>
        <div style={{ display: 'flex', gap: 'var(--sp-6)', fontSize: 'var(--fs-caption)' }}>
          {(['today', 'month'] as const).map((period) => (
            <div key={period}>
              <div style={{ color: 'var(--text-3)', marginBottom: 'var(--sp-1)' }}>{period === 'today' ? STRINGS.usage.today : STRINGS.usage.month}</div>
              {(usage?.[period] ?? []).length === 0 ? (
                <div style={{ color: 'var(--text-3)' }}>—</div>
              ) : (
                (usage?.[period] ?? []).map((u) => (
                  <div key={`${u.provider}-${u.metric}`} style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--text-3)' }}>{u.provider} {u.metric}:</span> {Math.round(u.amount).toLocaleString()}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-2)' }}>
          index queue: {diag?.indexQueueDepth ?? 0}
        </div>
      </section>

      <section>
        <h3 style={sectionTitle}>{STRINGS.settings.diagnostics.logs}</h3>
        <pre
          style={{
            maxHeight: 200,
            overflow: 'auto',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-ctl)',
            padding: 'var(--sp-2)',
            fontSize: 11,
            color: 'var(--text-2)',
            margin: 0,
          }}
        >
          {(diag?.logTail ?? []).join('\n')}
        </pre>
        <button onClick={copy} style={copyButton}>
          {copied ? '✓' : STRINGS.settings.diagnostics.copy}
        </button>
      </section>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)', color: 'var(--text-1)' };
const cell: React.CSSProperties = { padding: 'var(--sp-1) var(--sp-3) var(--sp-1) 0', borderBottom: '1px solid var(--border)' };
const copyButton: React.CSSProperties = {
  marginTop: 'var(--sp-2)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-caption)',
  padding: 'var(--sp-1) var(--sp-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
  cursor: 'pointer',
};
