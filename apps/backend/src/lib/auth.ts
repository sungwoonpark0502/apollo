import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { type Store, type User } from '../store/store';

/**
 * L1 session lifecycle, server side. Short-lived HS256 session JWT (15 min) +
 * an opaque rotating refresh token. Refresh tokens are stored only as SHA-256
 * hashes; reuse of an already-rotated token revokes the whole family (standard
 * OAuth refresh-token-rotation reuse detection).
 */
export const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ISSUER = 'apollo-backend';
const AUDIENCE = 'apollo-desktop';

export interface SessionClaims extends JWTPayload {
  sub: string; // user id
  plan: string;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createAuth(secret: Uint8Array, now: () => number = Date.now) {
  return {
    async signAccessToken(user: User): Promise<string> {
      const iat = Math.floor(now() / 1000);
      return new SignJWT({ plan: user.plan })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TTL_SEC)
        .sign(secret);
    },

    /** Verifies signature, alg, issuer, audience, and expiry. Throws on any failure. */
    async verifyAccessToken(token: string): Promise<SessionClaims> {
      const { payload } = await jwtVerify(token, secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'], // pin: never allow alg confusion / "none"
        currentDate: new Date(now()),
      });
      return payload as SessionClaims;
    },

    /** Mints an opaque refresh token and records only its hash. */
    async issueRefreshToken(store: Store, userId: string): Promise<string> {
      const raw = randomBytes(32).toString('base64url');
      await store.putRefresh({ tokenHash: hashToken(raw), userId, expiresAt: now() + REFRESH_TTL_MS, rotatedAt: null });
      return raw;
    },

    /**
     * Rotates a refresh token. Returns the user + a fresh refresh token, or
     * null when the token is unknown/expired. Reuse of a rotated token is
     * treated as compromise: the user's whole refresh family is revoked.
     */
    async rotateRefreshToken(store: Store, raw: string): Promise<{ user: User; refreshToken: string } | null> {
      const rec = await store.getRefresh(hashToken(raw));
      if (!rec) return null;
      if (rec.rotatedAt !== null) {
        await store.revokeUserRefresh(rec.userId); // reuse detected → revoke family
        return null;
      }
      if (rec.expiresAt <= now()) return null;
      await store.markRefreshRotated(rec.tokenHash, now());
      const user = await store.getUser(rec.userId);
      if (!user) return null;
      const refreshToken = await this.issueRefreshToken(store, user.id);
      return { user, refreshToken };
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
