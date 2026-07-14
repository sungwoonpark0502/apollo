import { type Session } from 'electron';

/**
 * H3 permission lockdown. The default session denies every web permission
 * request/check. The audio capture window runs on a dedicated session that
 * allows only 'media' (audio). Display capture, geolocation, notifications-via-
 * web, midi, hid: all denied.
 */

/** Pure decision for the default session: deny everything. */
export function defaultSessionAllows(_permission: string): boolean {
  return false;
}

/** Pure decision for the audio session: only 'media' is allowed. */
export function audioSessionAllows(permission: string): boolean {
  return permission === 'media';
}

export function lockDownSession(session: Session, allow: (permission: string) => boolean, log?: (msg: string) => void): void {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = allow(permission);
    if (!ok) log?.(`permission request denied: ${permission}`);
    callback(ok);
  });
  session.setPermissionCheckHandler((_wc, permission) => allow(permission));
  // Belt and suspenders: also deny device selection prompts.
  session.setDevicePermissionHandler(() => false);
}
