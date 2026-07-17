import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invokeChannels, pushChannels } from '@apollo/shared';
import { limitFor } from './throttle';

/**
 * J1.4 channel-registry completeness (Phase 10). Every channel referenced
 * anywhere in the codebase must exist in ipc.ts with request + response schemas,
 * be subject to the router's uniform senderFrame check, and have a throttle
 * bucket (explicit or default). settings.changed must be registered (E7/F5/I2).
 */
const REPO = join(__dirname, '../../../../..');
const SRC_DIRS = [join(REPO, 'apps/desktop/src'), join(REPO, 'packages/shared/src')];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'out') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Channel names referenced in product code: renderer call/on + main pushTo. */
function referencedChannels(): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /apollo\.call\(\s*['"]([\w.]+)['"]/gi, // window.apollo.call('x')
    /apollo\.on\(\s*['"]([\w.]+)['"]/gi, // window.apollo.on('x')
    /pushTo\([^,]+,\s*['"]([\w.]+)['"]/gi, // pushTo(wc, 'x')
  ];
  for (const dir of SRC_DIRS) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const re of patterns) {
        for (const m of text.matchAll(re)) names.add(m[1]!);
      }
    }
  }
  return names;
}

const invokeNames = new Set(Object.keys(invokeChannels));
const pushNames = new Set(Object.keys(pushChannels));

describe('IPC channel registry completeness (J1.4)', () => {
  it('every referenced channel exists in the ipc.ts registry', () => {
    const missing = [...referencedChannels()].filter((n) => !invokeNames.has(n) && !pushNames.has(n));
    expect(missing, `unregistered channels referenced in source: ${missing.join(', ')}`).toEqual([]);
  });

  it('settings.changed is a registered push channel (relied on by E7/F5/I2)', () => {
    expect(pushNames.has('settings.changed')).toBe(true);
  });

  it('every invoke channel has both a request and a response schema', () => {
    for (const [name, def] of Object.entries(invokeChannels)) {
      expect(def.req, `${name}.req`).toBeDefined();
      expect(def.res, `${name}.res`).toBeDefined();
    }
  });

  it('every invoke channel has a throttle bucket (explicit or default)', () => {
    for (const name of invokeNames) {
      const limit = limitFor(name as keyof typeof invokeChannels);
      expect(typeof limit, name).toBe('number');
      expect(limit).toBeGreaterThan(0);
    }
  });

  it('every push channel has a payload schema', () => {
    for (const [name, schema] of Object.entries(pushChannels)) {
      expect(schema, `${name} push schema`).toBeDefined();
    }
  });
});
