import React, { useEffect, useState } from 'react';
import { fmtRelative, STRINGS, type InvokeRes, type Settings } from '@apollo/shared';

// Presentation config: which rules exist and which inline params they expose.
const RULE_META: Array<{ id: string; params: Array<{ key: string; label: string; kind: 'minutes' | 'hour' | 'hours'; def: number }> }> = [
  { id: 'meeting_lead', params: [{ key: 'leadMin', label: STRINGS.settings.proactive.leadMinutes, kind: 'minutes', def: 10 }] },
  { id: 'tomorrow_preview', params: [{ key: 'atHH', label: STRINGS.settings.proactive.digestTime, kind: 'hour', def: 21 }] },
  { id: 'overdue_todos', params: [{ key: 'atHH', label: STRINGS.settings.proactive.digestTime, kind: 'hour', def: 16 }] },
  { id: 'needs_reply', params: [
    { key: 'atHH', label: STRINGS.settings.proactive.digestTime, kind: 'hour', def: 13 },
    { key: 'staleHours', label: STRINGS.settings.proactive.staleHours, kind: 'hours', def: 48 },
  ] },
  { id: 'weather_heads_up', params: [] },
];

type Recent = InvokeRes<'proactive.recent'>;

export function ProactiveTab(): React.JSX.Element {
  const p = STRINGS.settings.proactive;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recent, setRecent] = useState<Recent>([]);

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
    void window.apollo.call('proactive.recent', { limit: 10 }).then(setRecent);
  }, []);

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;
  const pro = settings.proactive;

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };
  const setRule = (id: string, enabled: boolean): void => {
    patch({ ...settings, proactive: { ...pro, rules: { ...pro.rules, [id]: { enabled, params: pro.rules[id]?.params ?? {} } } } });
  };
  const setParam = (id: string, key: string, value: number): void => {
    const cur = pro.rules[id] ?? { enabled: true, params: {} };
    patch({ ...settings, proactive: { ...pro, rules: { ...pro.rules, [id]: { enabled: cur.enabled, params: { ...cur.params, [key]: value } } } } });
  };
  const ruleEnabled = (id: string): boolean => pro.rules[id]?.enabled ?? true;
  const ruleParamValue = (id: string, key: string, def: number): number => Number(pro.rules[id]?.params[key] ?? def);

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-3)' }}>{p.title}</h2>

      <Row>
        <label style={toggleLabel}>
          <input type="checkbox" checked={pro.enabled} onChange={(e) => patch({ ...settings, proactive: { ...pro, enabled: e.target.checked } })} />
          {p.master}
        </label>
      </Row>

      <Row>
        <span>{p.maxPerDay}</span>
        <input type="number" min={0} max={20} value={pro.maxPerDay}
          onChange={(e) => patch({ ...settings, proactive: { ...pro, maxPerDay: Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)) } })}
          style={{ ...numInput, width: 64 }} />
      </Row>

      <Row>
        <label style={toggleLabel}>
          <input type="checkbox" checked={pro.voiceOnNudges} onChange={(e) => patch({ ...settings, proactive: { ...pro, voiceOnNudges: e.target.checked } })} />
          {p.voiceOnNudges}
        </label>
      </Row>

      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', margin: 'var(--sp-3) 0', lineHeight: 1.5 }}>
        {STRINGS.nudges.quietExplanation}
      </div>

      {RULE_META.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: 'var(--sp-3) 0' }}>
          <label style={{ ...toggleLabel, fontWeight: 500 }}>
            <input type="checkbox" checked={ruleEnabled(r.id) && pro.enabled} disabled={!pro.enabled} onChange={(e) => setRule(r.id, e.target.checked)} />
            {STRINGS.nudges.ruleNames[r.id] ?? r.id}
          </label>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', margin: 'var(--sp-1) 0 var(--sp-2) 24px' }}>
            {STRINGS.nudges.ruleDescriptions[r.id] ?? ''}
          </div>
          {r.params.map((param) => (
            <div key={param.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', margin: '0 0 var(--sp-1) 24px' }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{param.label}</span>
              <input
                type="number"
                min={param.kind === 'hour' ? 0 : 1}
                max={param.kind === 'hour' ? 23 : param.kind === 'minutes' ? 120 : 336}
                value={ruleParamValue(r.id, param.key, param.def)}
                onChange={(e) => setParam(r.id, param.key, parseInt(e.target.value, 10) || param.def)}
                style={{ ...numInput, width: 56 }}
              />
            </div>
          ))}
        </div>
      ))}

      <h3 style={{ fontSize: 'var(--fs-title)', margin: 'var(--sp-5) 0 var(--sp-2)' }}>{p.recent}</h3>
      {recent.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>{p.noRecent}</div>
      ) : (
        recent.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-1) 0', fontSize: 'var(--fs-caption)' }}>
            <span style={{ color: 'var(--text-1)' }}>{s.title}</span>
            <span style={{ color: 'var(--text-3)' }}>
              {fmtRelative(s.createdAt)}{s.outcome ? ` · ${p.outcomeLabels[s.outcome] ?? s.outcome}` : ''}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-2) 0' }}>{children}</div>;
}

const toggleLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-body)', color: 'var(--text-1)', cursor: 'pointer' };
const numInput: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', padding: 'var(--sp-1) var(--sp-2)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-ctl)', background: 'var(--bg)', color: 'var(--text-1)', outline: 'none',
};
