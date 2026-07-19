import React, { useEffect, useRef, useState } from 'react';
import { STRINGS, type AuthStatus } from '@apollo/shared';
import { Icon, type IconName } from './Icon';

/**
 * The account control at the foot of the rail: an avatar row that opens a menu,
 * rather than a gear that jumped straight into Settings. Sign out in particular
 * was buried at the bottom of a Settings tab, which is the wrong place for the
 * one action a user wants to reach quickly on a shared machine.
 *
 * Only real destinations appear here. A menu that lists things the app cannot
 * do is worse than a short menu.
 */
interface AuthUser {
  name: string;
  email: string;
  plan: string;
}

export function AccountMenu({ mode }: { mode: 'managed' | 'byok' }): React.JSX.Element {
  const a = STRINGS.workspace.accountMenu;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AuthStatus>('signedOut');
  const [user, setUser] = useState<AuthUser | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      window.apollo.on('auth.state', (s) => {
        setStatus(s.status);
        setUser(s.user ?? null);
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signedIn = status === 'signedIn' && user !== null;
  // BYOK has no account, so the row identifies the machine's own profile
  // instead of pretending there is one to sign out of.
  const primary = signedIn ? user.name || user.email : mode === 'byok' ? a.localProfile : a.signedOut;
  const secondary = signedIn ? a.plan(user.plan) : mode === 'byok' ? a.byokSubtitle : a.signInPrompt;
  const initial = (signedIn ? user.name || user.email : 'A').trim().charAt(0).toUpperCase();

  const openSettings = (): void => {
    setOpen(false);
    void window.apollo.call('settings.open', {});
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open ? (
        <div role="menu" style={panel}>
          {signedIn ? <div style={emailHeader}>{user.email}</div> : null}
          <MenuItem icon="settings" label={a.settings} shortcut={a.settingsShortcut} onClick={openSettings} />
          <MenuItem icon="help" label={a.help} onClick={openSettings} />
          {signedIn ? (
            <>
              <div style={divider} />
              <MenuItem
                icon="signOut"
                label={a.signOut}
                onClick={() => {
                  setOpen(false);
                  void window.apollo.call('auth.signOut', {});
                }}
              />
            </>
          ) : mode === 'managed' ? (
            <>
              <div style={divider} />
              <MenuItem icon="signOut" label={a.signIn} onClick={openSettings} />
            </>
          ) : null}
        </div>
      ) : null}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={a.trigger}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          width: '100%',
          padding: 'var(--sp-1) var(--sp-2)',
          border: 'none',
          borderRadius: 'var(--radius-ctl)',
          background: open ? 'var(--accent-soft)' : 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <span style={avatar} aria-hidden="true">
          {initial}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-body)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {primary}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {secondary}
          </span>
        </span>
      </button>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  onClick: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        width: '100%',
        padding: 'var(--sp-2) var(--sp-3)',
        border: 'none',
        background: hover ? 'var(--accent-soft)' : 'transparent',
        color: 'var(--text-1)',
        cursor: 'pointer',
        fontSize: 'var(--fs-body)',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left',
        borderRadius: 'var(--radius-ctl)',
      }}
    >
      <span style={{ color: 'var(--text-2)', display: 'flex' }}>
        <Icon name={icon} size={16} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut ? <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>{shortcut}</span> : null}
    </button>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  right: 0,
  minWidth: 220,
  marginBottom: 'var(--sp-1)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--sp-1)',
  zIndex: 50,
};

const emailHeader: React.CSSProperties = {
  padding: 'var(--sp-2) var(--sp-3)',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const divider: React.CSSProperties = {
  height: 1,
  background: 'var(--border)',
  margin: 'var(--sp-1) var(--sp-2)',
};

const avatar: React.CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: '50%',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  display: 'grid',
  placeContent: 'center',
  fontSize: 'var(--fs-caption)',
  fontWeight: 600,
};
