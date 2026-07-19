import React, { useEffect, useState } from 'react';
import { newId, STRINGS, type Settings } from '@apollo/shared';
import { Toggle } from '../../components/Toggle';
import { Icon } from '../../components/Icon';

/**
 * Skills v1: named instruction packs the user writes themselves, toggleable,
 * appended to the system prompt when enabled (applySkills). No code execution,
 * no third-party marketplace — those need a permission and distribution story
 * first (HUMAN_TODO). This is the part that is safe and useful today: "reply in
 * Korean", "keep answers terse", "always use 24-hour times".
 */
export function SkillsSection(): React.JSX.Element {
  const t = STRINGS.settings.customize;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState({ name: '', prompt: '' });

  useEffect(() => {
    void window.apollo.call('settings.get', {}).then(setSettings);
  }, []);

  if (!settings) return <div style={{ color: 'var(--text-3)' }}>…</div>;
  const skills = settings.skills;

  const patch = (next: Settings): void => {
    setSettings(next);
    void window.apollo.call('settings.set', next);
  };

  const startEdit = (id: string | 'new'): void => {
    const existing = id === 'new' ? null : skills.find((s) => s.id === id);
    setDraft(existing ? { name: existing.name, prompt: existing.prompt } : { name: '', prompt: '' });
    setEditing(id);
  };

  const save = (): void => {
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    if (!name || !prompt || editing === null) return;
    const next =
      editing === 'new'
        ? [...skills, { id: newId(), name, prompt, enabled: true }]
        : skills.map((s) => (s.id === editing ? { ...s, name, prompt } : s));
    patch({ ...settings, skills: next });
    setEditing(null);
  };

  const remove = (id: string): void => {
    patch({ ...settings, skills: skills.filter((s) => s.id !== id) });
    if (editing === id) setEditing(null);
  };

  return (
    <div>
      {skills.length === 0 && editing === null ? (
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-3)', margin: '0 0 var(--sp-2)' }}>{t.skillsEmpty}</p>
      ) : null}

      {skills.map((s) =>
        editing === s.id ? (
          <SkillEditor key={s.id} draft={draft} onDraft={setDraft} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={s.id} style={row}>
            <Toggle
              checked={s.enabled}
              ariaLabel={s.name}
              onChange={(v) => patch({ ...settings, skills: skills.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)) })}
            />
            <button onClick={() => startEdit(s.id)} style={rowMain} title={s.prompt}>
              <span style={{ display: 'block', fontSize: 'var(--fs-body)', color: s.enabled ? 'var(--text-1)' : 'var(--text-3)' }}>{s.name}</span>
              <span style={rowSnippet}>{s.prompt}</span>
            </button>
            <button onClick={() => remove(s.id)} aria-label={t.skillDelete} style={iconBtn}>
              <Icon name="close" size={13} />
            </button>
          </div>
        ),
      )}

      {editing === 'new' ? (
        <SkillEditor draft={draft} onDraft={setDraft} onSave={save} onCancel={() => setEditing(null)} />
      ) : skills.length < 20 ? (
        <button onClick={() => startEdit('new')} style={addBtn}>
          {t.skillAdd}
        </button>
      ) : null}
    </div>
  );
}

function SkillEditor({
  draft,
  onDraft,
  onSave,
  onCancel,
}: {
  draft: { name: string; prompt: string };
  onDraft: (d: { name: string; prompt: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = STRINGS.settings.customize;
  const valid = draft.name.trim().length > 0 && draft.prompt.trim().length > 0 && draft.prompt.length <= 2000;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
      <input
        value={draft.name}
        onChange={(e) => onDraft({ ...draft, name: e.target.value.slice(0, 60) })}
        placeholder={t.skillNamePlaceholder}
        aria-label={t.skillName}
        autoFocus
        style={{ ...field, marginBottom: 'var(--sp-2)' }}
      />
      <textarea
        value={draft.prompt}
        onChange={(e) => onDraft({ ...draft, prompt: e.target.value.slice(0, 2000) })}
        placeholder={t.skillPromptPlaceholder}
        aria-label={t.skillPrompt}
        rows={3}
        style={{ ...field, resize: 'vertical', marginBottom: 'var(--sp-2)' }}
      />
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <button onClick={onSave} disabled={!valid} style={{ ...saveBtn, opacity: valid ? 1 : 0.5 }}>
          {t.skillSave}
        </button>
        <button onClick={onCancel} style={cancelBtn}>
          {t.skillCancel}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{draft.prompt.length}/2000</span>
      </div>
    </div>
  );
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0',
  borderBottom: '1px solid var(--border)',
};
const rowMain: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--font-sans)', padding: 0,
};
const rowSnippet: React.CSSProperties = {
  display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-3)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 'var(--sp-1)',
};
const addBtn: React.CSSProperties = {
  marginTop: 'var(--sp-2)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--accent)',
  borderRadius: 'var(--radius-ctl)', padding: 'var(--sp-2) var(--sp-3)', cursor: 'pointer',
  fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const field: React.CSSProperties = {
  width: '100%', padding: 'var(--sp-2)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-1)', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const saveBtn: React.CSSProperties = {
  border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const cancelBtn: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', borderRadius: 'var(--radius-ctl)',
  padding: 'var(--sp-1) var(--sp-3)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
