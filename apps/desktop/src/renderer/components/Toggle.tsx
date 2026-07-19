import React from 'react';

/**
 * The themed on/off control. Settings used raw `<input type="checkbox">`, which
 * renders as the platform's own square checkbox — a different shape and a
 * different blue on macOS and Windows, ignoring the token palette entirely.
 *
 * This is a rounded switch driven by the same tokens as everything else
 * (--accent when on, --border when off). It stays a real checkbox underneath,
 * visually hidden, so keyboard focus, Space to toggle, form semantics, and
 * screen readers all behave exactly as before — only the paint changes.
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the control has no adjacent <label> text. */
  ariaLabel?: string;
}

const W = 34;
const H = 20;
const KNOB = 14;

export function Toggle({ checked, onChange, disabled = false, ariaLabel }: ToggleProps): React.JSX.Element {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        width: W,
        height: H,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        // Visually hidden but still the real focusable control: opacity 0 rather
        // than display:none, or it would drop out of the tab order.
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          opacity: 0,
          cursor: disabled ? 'default' : 'pointer',
          zIndex: 1,
        }}
      />
      <span
        aria-hidden="true"
        className="apollo-toggle-track"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: H / 2,
          background: checked ? 'var(--accent)' : 'var(--border)',
          transition: 'background 140ms var(--ease)',
          display: 'block',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: (H - KNOB) / 2,
          left: checked ? W - KNOB - (H - KNOB) / 2 : (H - KNOB) / 2,
          width: KNOB,
          height: KNOB,
          borderRadius: '50%',
          background: 'var(--surface)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.28)',
          transition: 'left 140ms var(--ease)',
        }}
      />
    </span>
  );
}

/**
 * A full settings row: label (with optional description) on the left, the
 * toggle on the right. Clicking anywhere on the row toggles it, because a 34px
 * switch is a small target for a whole line of text.
 */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-2) 0',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-body)', color: 'var(--text-1)' }}>{label}</span>
        {description ? (
          <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 2 }}>{description}</span>
        ) : null}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
