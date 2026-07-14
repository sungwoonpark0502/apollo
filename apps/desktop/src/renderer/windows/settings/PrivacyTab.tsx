import React, { useEffect, useState } from 'react';
import { STRINGS, type Settings } from '@apollo/shared';
import { buttonStyle } from '../../components/cards/TimerCard';

interface Privacy {
  egressHosts: string[];
  memoryFacts: Array<{ id: string; category: string; fact: string }>;
}

type IndexStats = { note: number; message: number; fact: number; total: number; pending: number; sizeBytes: number; enabled: boolean; embedder: string };

export function PrivacyTab(): React.JSX.Element {
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [wipeText, setWipeText] = useState('');
  const [newDir, setNewDir] = useState('');

  const refresh = (): void => {
    void window.apollo.call('privacy.get', {}).then(setPrivacy);
    void window.apollo.call('settings.get', {}).then(setSettings);
    void window.apollo.call('memory.indexStats', {}).then(setStats);
  };
  useEffect(refresh, []);

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  const deleteFact = (id: string): void => {
    void window.apollo.call('privacy.deleteMemory', { id }).then(refresh);
  };

  const wipe = (): void => {
    if (wipeText !== STRINGS.settings.privacy.wipeConfirmWord) return;
    void window.apollo.call('privacy.wipe', { confirm: 'ERASE' });
  };

  if (!privacy || !settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;
  const s = settings;

  return (
    <div>
      <h2 style={{ fontSize: 'var(--fs-display)', margin: '0 0 var(--sp-4)' }}>{STRINGS.settings.tabs.privacy}</h2>

      <DataSection settings={s} patch={patch} />
      <ActionLogSection />


      <Row label={STRINGS.settings.privacy.history}>
        <input
          type="checkbox"
          checked={settings.history.enabled}
          onChange={(e) => patch({ ...settings, history: { enabled: e.target.checked } })}
        />
      </Row>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', margin: '0 0 var(--sp-3)' }}>{STRINGS.settings.privacy.historyHint}</div>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.memoryIndex}</h3>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-2)' }}>{STRINGS.settings.privacy.memoryIndexWhat}</div>
        {stats ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
            {stats.enabled
              ? STRINGS.settings.privacy.memoryIndexCounts(stats.note, stats.message, stats.fact, (stats.sizeBytes / 1_048_576).toFixed(1))
              : STRINGS.settings.privacy.memoryIndexDisabled}
            {stats.pending > 0 ? ` · ${STRINGS.settings.privacy.memoryIndexPending(stats.pending)}` : ''}
            <div style={{ color: 'var(--text-3)', marginTop: 2 }}>{STRINGS.settings.privacy.embedderState(stats.embedder)}</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <button style={buttonStyle} onClick={() => void window.apollo.call('memory.rebuild', {}).then(() => setTimeout(refresh, 300))}>
            {STRINGS.settings.privacy.rebuildIndex}
          </button>
          <button style={buttonStyle} onClick={() => void window.apollo.call('memory.clear', {}).then(refresh)}>
            {STRINGS.settings.privacy.clearIndex}
          </button>
        </div>
      </section>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.memoryFacts}</h3>
        {privacy.memoryFacts.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>Nothing remembered yet.</div>
        ) : (
          privacy.memoryFacts.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-1) 0' }}>
              <span style={{ fontSize: 'var(--fs-caption)' }}>
                <span style={{ color: 'var(--text-3)' }}>{f.category}: </span>
                {f.fact}
              </span>
              <button onClick={() => deleteFact(f.id)} aria-label={STRINGS.cards.delete} style={{ ...buttonStyle, color: 'var(--danger)' }}>
                {STRINGS.cards.delete}
              </button>
            </div>
          ))
        )}
      </section>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.approvedDirs}</h3>
        {settings.approvedDirs.map((d) => (
          <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-1) 0' }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{d}</span>
            <button
              onClick={() => patch({ ...settings, approvedDirs: settings.approvedDirs.filter((x) => x !== d) })}
              style={{ ...buttonStyle, color: 'var(--danger)' }}
            >
              {STRINGS.cards.delete}
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="/Users/you/Documents"
            style={inputStyle}
          />
          <button
            onClick={() => {
              if (newDir.trim()) patch({ ...settings, approvedDirs: [...settings.approvedDirs, newDir.trim()] });
              setNewDir('');
            }}
            style={buttonStyle}
          >
            Add
          </button>
        </div>
      </section>

      <section style={{ margin: 'var(--sp-4) 0' }}>
        <h3 style={sectionTitle}>{STRINGS.settings.privacy.egress}</h3>
        <ul style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', columns: 2, listStyle: 'none', padding: 0 }}>
          {privacy.egressHosts.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>
        <h3 style={{ ...sectionTitle, color: 'var(--danger)' }}>{STRINGS.settings.privacy.wipe}</h3>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 'var(--sp-2)' }}>
          {STRINGS.settings.privacy.wipeConfirmPrompt}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder={STRINGS.settings.privacy.wipeConfirmWord} style={inputStyle} />
          <button
            onClick={wipe}
            disabled={wipeText !== STRINGS.settings.privacy.wipeConfirmWord}
            style={{
              ...buttonStyle,
              color: '#fff',
              background: wipeText === STRINGS.settings.privacy.wipeConfirmWord ? 'var(--danger)' : 'var(--text-3)',
              borderColor: 'transparent',
            }}
          >
            {STRINGS.settings.privacy.wipe}
          </button>
        </div>
      </section>
    </div>
  );
}

interface BackupItem { filename: string; reason: 'pre-migrate' | 'auto' | 'manual'; sizeBytes: number; createdAt: number }

function DataSection({ settings, patch }: { settings: Settings; patch: (s: Settings) => void }): React.JSX.Element {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [status, setStatus] = useState('');
  const [inclChats, setInclChats] = useState(false);

  const refreshBackups = (): void => {
    void window.apollo.call('backup.list', {}).then(setBackups);
  };
  useEffect(refreshBackups, []);

  return (
    <section style={{ margin: 'var(--sp-4) 0' }}>
      <h3 style={sectionTitle}>{STRINGS.settings.privacy.data}</h3>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={buttonStyle} onClick={() => void window.apollo.call('backup.now', {}).then(() => { refreshBackups(); setStatus('✓'); })}>
          {STRINGS.settings.privacy.backupNow}
        </button>
        <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={inclChats} onChange={(e) => setInclChats(e.target.checked)} />
          {STRINGS.settings.privacy.exportWithChats}
        </label>
        <button style={buttonStyle} onClick={() => void window.apollo.call('export.run', { includeConversations: inclChats }).then((r) => setStatus(r.path ? STRINGS.settings.privacy.exportDone(r.path) : ''))}>
          {STRINGS.settings.privacy.export}
        </button>
        <button style={buttonStyle} onClick={() => void window.apollo.call('import.run', {}).then((r) => { if (r.counts) { const n = Object.values(r.counts).reduce((a, b) => a + b, 0); setStatus(STRINGS.settings.privacy.importDone(n)); } })}>
          {STRINGS.settings.privacy.import}
        </button>
        <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={settings.backup.autoWeekly} onChange={(e) => patch({ ...settings, backup: { autoWeekly: e.target.checked } })} />
          Weekly auto-backup
        </label>
      </div>
      {status ? <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginTop: 'var(--sp-2)' }}>{status}</div> : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginBottom: 'var(--sp-1)' }}>{STRINGS.settings.privacy.backups}</div>
        {backups.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>—</div>
        ) : (
          backups.slice(0, 10).map((b) => (
            <div key={b.filename} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--sp-1) 0' }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
                {new Date(b.createdAt).toLocaleString()} · {b.reason} · {(b.sizeBytes / 1024).toFixed(0)} KB
              </span>
              <button style={buttonStyle} onClick={() => void window.apollo.call('backup.restore', { filename: b.filename })}>
                {STRINGS.settings.privacy.restore}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

interface ActionRow { id: string; ts: number; tool: string; summary: string; outcome: string }

function ActionLogSection(): React.JSX.Element {
  const [rows, setRows] = useState<ActionRow[]>([]);
  useEffect(() => {
    void window.apollo.call('actionLog.list', {}).then(setRows);
  }, []);
  const color: Record<string, string> = { executed: 'var(--success)', denied: 'var(--danger)', canceled: 'var(--text-3)', expired: 'var(--text-3)', undone: 'var(--accent)' };
  return (
    <section style={{ margin: 'var(--sp-4) 0' }}>
      <h3 style={sectionTitle}>{STRINGS.settings.privacy.actionLog}</h3>
      {rows.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{STRINGS.settings.privacy.actionLogEmpty}</div>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', padding: 'var(--sp-1) 0', fontSize: 'var(--fs-caption)' }}>
            <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text-3)' }}>{new Date(r.ts).toLocaleString()} · </span>
              {r.summary}
            </span>
            <span style={{ color: color[r.outcome] ?? 'var(--text-3)', flexShrink: 0 }}>{r.outcome}</span>
          </div>
        ))
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
      {children}
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)', color: 'var(--text-1)' };
const inputStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-caption)',
  padding: 'var(--sp-1) var(--sp-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-ctl)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
};
