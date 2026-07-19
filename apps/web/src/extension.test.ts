import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Chrome extension's whole security story is what it does NOT request.
 * These pin that: a future edit that adds host permissions or content scripts
 * must consciously delete a test that says why they are absent.
 */
const root = join(__dirname, '../../chrome-extension');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: unknown[];
  background?: { service_worker?: string };
};

describe('chrome extension manifest', () => {
  it('is MV3 with a service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background?.service_worker).toBe('background.js');
  });

  it('requests no host permissions and injects no content scripts', () => {
    // The extension must not be able to read any page.
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.content_scripts ?? []).toEqual([]);
    expect(manifest.permissions).toEqual(['contextMenus']);
    expect(manifest.permissions).not.toContain('scripting');
    expect(manifest.permissions).not.toContain('tabs');
  });
});

describe('chrome extension behavior source', () => {
  const src = readFileSync(join(root, 'background.js'), 'utf8');

  it('only ever opens the Apollo web origin', () => {
    const urls = src.match(/https:\/\/[^'"`\s]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith('https://app.apolloassistant.app')).toBe(true);
  });

  it('prefills via ?q= and never calls the API directly', () => {
    expect(src).toContain('?q=');
    expect(src).toContain('encodeURIComponent');
    // No fetch: the extension holds no tokens and talks to no backend.
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
