import { describe, expect, it } from 'vitest';
import { assistantReadiness, settingsTabsFor, type ReadinessInputs } from './readiness';
import { STRINGS } from './strings';

/**
 * L5: the "add your Anthropic and Deepgram keys" banner is deleted and
 * readiness is fixed at the source — managed mode keys off auth, BYOK off
 * local keys. These tests are the guard against the banner ever coming back.
 */
const managed = (over: Partial<ReadinessInputs> = {}): ReadinessInputs => ({
  mode: 'managed',
  authStatus: 'signedIn',
  hasLlmKey: false,
  hasSttKey: false,
  ...over,
});
const byok = (over: Partial<ReadinessInputs> = {}): ReadinessInputs => ({
  mode: 'byok',
  authStatus: 'signedOut',
  hasLlmKey: true,
  hasSttKey: true,
  ...over,
});

describe('L5 managed-mode readiness', () => {
  it('a signed-in user with NO local keys is fully ready (keys are the backend’s job)', () => {
    expect(assistantReadiness(managed())).toEqual({ kind: 'ready' });
  });

  it('signed out asks for sign-in — never for keys', () => {
    for (const status of ['signedOut', 'signingIn'] as const) {
      const state = assistantReadiness(managed({ authStatus: status }));
      expect(state.kind).toBe('signInRequired');
      expect(state.kind).not.toBe('keysRequired');
    }
  });

  it('over quota is its own state so local features keep working', () => {
    expect(assistantReadiness(managed({ quotaExceeded: true }))).toEqual({ kind: 'quotaExceeded' });
  });

  it('managed mode can NEVER produce a keys-required state, whatever the key situation', () => {
    for (const hasLlmKey of [true, false]) {
      for (const hasSttKey of [true, false]) {
        for (const authStatus of ['signedOut', 'signingIn', 'signedIn'] as const) {
          const state = assistantReadiness(managed({ hasLlmKey, hasSttKey, authStatus }));
          expect(state.kind, JSON.stringify({ hasLlmKey, hasSttKey, authStatus })).not.toBe('keysRequired');
        }
      }
    }
  });
});

describe('L5 BYOK readiness (unchanged developer path)', () => {
  it('is ready with both local keys and needs no sign-in', () => {
    expect(assistantReadiness(byok())).toEqual({ kind: 'ready' });
  });

  it('names exactly the missing local keys', () => {
    expect(assistantReadiness(byok({ hasLlmKey: false }))).toEqual({ kind: 'keysRequired', missing: ['llm'] });
    expect(assistantReadiness(byok({ hasSttKey: false }))).toEqual({ kind: 'keysRequired', missing: ['stt'] });
    expect(assistantReadiness(byok({ hasLlmKey: false, hasSttKey: false }))).toEqual({ kind: 'keysRequired', missing: ['llm', 'stt'] });
  });

  it('never asks a BYOK developer to sign in', () => {
    expect(assistantReadiness(byok({ authStatus: 'signedOut' })).kind).toBe('ready');
  });
});

describe('L5 settings tabs by mode', () => {
  it('managed shows Account and hides Keys entirely', () => {
    const tabs = settingsTabsFor('managed');
    expect(tabs).toContain('account');
    expect(tabs).not.toContain('keys');
    expect(tabs[0]).toBe('account'); // first, per L5
  });

  it('BYOK shows Keys and hides Account', () => {
    const tabs = settingsTabsFor('byok');
    expect(tabs).toContain('keys');
    expect(tabs).not.toContain('account');
  });

  it('neither mode exposes Diagnostics as a top-level tab (it moved under About)', () => {
    expect(settingsTabsFor('managed')).not.toContain('diagnostics');
    expect(settingsTabsFor('byok')).not.toContain('diagnostics');
  });
});

describe('L5 the keys banner string is gone', () => {
  it('no string in the catalog asks the user to add Anthropic/Deepgram keys', () => {
    const flat = JSON.stringify(STRINGS, (_k, v: unknown) => (typeof v === 'function' ? String(v) : v));
    expect(flat).not.toMatch(/add your Anthropic and Deepgram keys/i);
    expect(flat).not.toMatch(/limited until you add/i);
  });
});
