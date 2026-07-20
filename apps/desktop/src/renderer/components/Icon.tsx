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
export type IconName = 'pin' | 'close' | 'copy' | 'speak' | 'retry' | 'edit' | 'home' | 'chat' | 'calendar' | 'note' | 'settings' | 'help' | 'signOut' | 'search' | 'bold' | 'italic' | 'code' | 'bulletList' | 'orderedList' | 'checklist' | 'quote' | 'h1' | 'h2' | 'h3';

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
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  speak: (
    <>
      <path d="M2.5 6.2h2.4L8.4 3v10L4.9 9.8H2.5z" />
      <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8" />
      <path d="M12.4 3.8a6 6 0 0 1 0 8.4" />
    </>
  ),
  retry: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
      <path d="M13.4 2.6v2.8h-2.8" />
    </>
  ),
  edit: (
    <>
      <path d="m9.6 3.4 3 3L6 13H3v-3z" />
      <path d="m8.4 4.6 3 3" />
    </>
  ),
  // Rail navigation. A house that reads as a house at 17px: roof, walls, door.
  home: (
    <>
      <path d="M2.5 7.8 8 3l5.5 4.8" />
      <path d="M3.8 7V12.6a.9.9 0 0 0 .9.9h6.6a.9.9 0 0 0 .9-.9V7" />
      <path d="M6.6 13.5V9.8h2.8v3.7" />
    </>
  ),
  chat: (
    <>
      <path d="M13.5 9.5a1.8 1.8 0 0 1-1.8 1.8H7.2L4 13.8v-2.5H4a1.8 1.8 0 0 1-1.5-1.8V4.3a1.8 1.8 0 0 1 1.8-1.8h7.4a1.8 1.8 0 0 1 1.8 1.8z" />
      <path d="M5.2 5.8h5.6" />
      <path d="M5.2 8.2h3.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.6h11" />
      <path d="M5.5 2v2.6" />
      <path d="M10.5 2v2.6" />
      <path d="M5.2 9.3h2" />
    </>
  ),
  note: (
    <>
      <path d="M3.5 3.6a1.1 1.1 0 0 1 1.1-1.1h5.6l2.3 2.3v8.6a1.1 1.1 0 0 1-1.1 1.1H4.6a1.1 1.1 0 0 1-1.1-1.1z" />
      <path d="M10 2.6V5h2.4" />
      <path d="M5.6 7.4h4.8" />
      <path d="M5.6 9.8h4.8" />
      <path d="M5.6 12.2h2.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
      <path d="M8 11.6h.01" />
    </>
  ),
  signOut: (
    <>
      <path d="M6.2 2.5H3.4A.9.9 0 0 0 2.5 3.4v9.2a.9.9 0 0 0 .9.9h2.8" />
      <path d="M10.6 11 13.5 8l-2.9-3" />
      <path d="M13.5 8H6.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="m10.5 10.5 3 3" />
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
