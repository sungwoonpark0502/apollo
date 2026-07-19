import React, { useEffect, useState } from 'react';
import { getAccessToken, loadSession } from './api';
import { SignIn } from './SignIn';
import { Workspace } from './Workspace';

/** Session gate: restore from the stored refresh token, else the sign-in form. */
export function App(): React.JSX.Element {
  const [user, setUser] = useState<{ name: string; email: string; plan: string } | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const stored = loadSession();
    if (!stored) {
      setRestoring(false);
      return;
    }
    // Validate the stored session by minting an access token; a revoked or
    // rotated-out refresh token lands back on the sign-in form.
    void getAccessToken().then((token) => {
      if (token) setUser(stored.user);
      setRestoring(false);
    });
  }, []);

  // A deep link (?q=… from the Chrome extension) survives sign-in: ChatApp
  // reads it after mount, so nothing is lost if the user has to log in first.
  if (restoring) {
    return <div style={{ display: 'grid', placeContent: 'center', height: '100%', color: 'var(--text-3)' }}>…</div>;
  }
  if (!user) return <SignIn onSignedIn={setUser} />;
  return <Workspace user={user} onSignedOut={() => setUser(null)} />;
}
