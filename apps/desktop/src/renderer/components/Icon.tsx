import React from 'react';

/**
 * Theme-following line icons. Emoji were being used as affordances (📌, ✕, ⦿),
 * which renders as a full-color platform glyph that ignores the token palette
 * and shifts between macOS and Windows. These inherit `currentColor` and scale
 * with the type scale instead, so a pinned row picks up --accent like every
 * other active control.
 *
 * Deliberately minimal: 1.5px strokes on a 16px grid, matching the rest of the
 * chrome. Add icons here rather than reaching for a glyph inline.
 */
export type IconName = 'pin' | 'close' | 'bold' | 'italic' | 'code' | 'bulletList' | 'orderedList' | 'checklist' | 'quote' | 'h1' | 'h2' | 'h3';

const PATHS: Record<IconName, React.ReactNode> = {
  // A pushpin reading clearly at 14-16px: head, shaft, point.
  pin: (
    <>
      <path d="M9.5 2.5 13.5 6.5" />
      <path d="M11.5 4.5 7.8 6.1a2 2 0 0 0-1 1l-.6 1.4 4.3 4.3 1.4-.6a2 2 0 0 0 1-1l1.6-3.7" />
      <path d="M6.2 9.8 2.5 13.5" />
    </>
  ),
  close: (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ),
  bold: (
    <>
      <path d="M5 3h4.5a3 3 0 0 1 0 6H5z" />
      <path d="M5 9h5a3 3 0 0 1 0 6H5z" />
    </>
  ),
  italic: (
    <>
      <path d="M10 3H6.5" />
      <path d="M9.5 15H6" />
      <path d="M9.5 3 7 15" />
    </>
  ),
  code: (
    <>
      <path d="M5.5 5 2 9l3.5 4" />
      <path d="M10.5 5 14 9l-3.5 4" />
    </>
  ),
  bulletList: (
    <>
      <circle cx="3" cy="5" r="1" />
      <circle cx="3" cy="9" r="1" />
      <circle cx="3" cy="13" r="1" />
      <path d="M6.5 5H14" />
      <path d="M6.5 9H14" />
      <path d="M6.5 13H14" />
    </>
  ),
  orderedList: (
    <>
      <path d="M2 4h1v3" />
      <path d="M2 9h2l-2 3h2" />
      <path d="M2 14h2" />
      <path d="M6.5 5H14" />
      <path d="M6.5 9H14" />
      <path d="M6.5 13H14" />
    </>
  ),
  checklist: (
    <>
      <path d="M2 5l1.2 1.2L5.5 4" />
      <path d="M2 11l1.2 1.2L5.5 10" />
      <path d="M8 5.5H14" />
      <path d="M8 11.5H14" />
    </>
  ),
  quote: (
    <>
      <path d="M3 4v11" />
      <path d="M6.5 6H14" />
      <path d="M6.5 10H12" />
    </>
  ),
  h1: (
    <>
      <path d="M2 4v9" />
      <path d="M7 4v9" />
      <path d="M2 8.5h5" />
      <path d="M10.5 7 12.5 5.5V13" />
    </>
  ),
  h2: (
    <>
      <path d="M2 4v9" />
      <path d="M7 4v9" />
      <path d="M2 8.5h5" />
      <path d="M10.5 6.5a1.8 1.8 0 1 1 3.2 1.2L10.5 13H14" />
    </>
  ),
  h3: (
    <>
      <path d="M2 4v9" />
      <path d="M7 4v9" />
      <path d="M2 8.5h5" />
      <path d="M10.6 5.8a1.7 1.7 0 1 1 1.6 2.6 1.8 1.8 0 1 1-1.6 2.8" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  /** Filled variant, used for the "on" state of a toggle like pin. */
  filled?: boolean;
  title?: string;
}

export function Icon({ name, size = 16, filled = false, title }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
