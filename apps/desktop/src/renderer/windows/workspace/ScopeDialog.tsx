import React from 'react';
import { STRINGS } from '@apollo/shared';
import { Modal } from './Modal';

/** E3.2 mandatory scope dialog for edits/moves/deletes on a recurring occurrence. */
export function ScopeDialog({
  onChoose,
  onCancel,
}: {
  onChoose: (scope: 'single' | 'all') => void;
  onCancel: () => void;
}): React.JSX.Element {
  const s = STRINGS.workspace.scopeDialog;
  return (
    <Modal onClose={onCancel} width={380}>
      <h2 style={{ fontSize: 'var(--fs-title)', margin: '0 0 var(--sp-2)' }}>{s.title}</h2>
      <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', margin: '0 0 var(--sp-4)' }}>{s.body}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        <button onClick={() => onChoose('single')} style={primaryBtn}>{s.single}</button>
        <button onClick={() => onChoose('all')} style={secondaryBtn}>{s.all}</button>
        <button onClick={onCancel} style={linkBtn}>{s.cancel}</button>
      </div>
    </Modal>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--accent)',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const secondaryBtn: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-ctl)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-sans)',
};
const linkBtn: React.CSSProperties = {
  padding: 'var(--sp-1)', border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
  fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-sans)',
};
