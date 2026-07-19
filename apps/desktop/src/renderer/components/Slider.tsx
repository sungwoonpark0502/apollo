import React from 'react';

/**
 * The themed range control. A bare `<input type="range">` paints the platform's
 * own track and thumb — grey on macOS, a different grey and a square thumb on
 * Windows — which ignored the token palette next to every other control.
 *
 * Still a real `<input type="range">`, so keyboard stepping, drag behavior, and
 * screen-reader semantics are untouched; only the paint is ours. The fill is a
 * gradient computed from the value, which is the one trick that avoids needing
 * a wrapper element behind the track.
 *
 * Track and thumb styling lives in tokens.css (.apollo-slider), because
 * ::-webkit-slider-thumb cannot be expressed as an inline style.
 */
export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Rendered to the right of the track; usually a formatted value. */
  valueLabel?: string;
  width?: number | string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  ariaLabel,
  valueLabel,
  width = 180,
}: SliderProps): React.JSX.Element {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', opacity: disabled ? 0.5 : 1 }}>
      <input
        className="apollo-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        style={{
          width,
          // The filled portion is the accent; the rest is the track color.
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
        }}
      />
      {valueLabel !== undefined ? (
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', minWidth: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {valueLabel}
        </span>
      ) : null}
    </span>
  );
}
