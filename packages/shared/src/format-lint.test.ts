import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

// I2 gate: the custom ESLint rule must flag ad-hoc display formatting anywhere
// outside format.ts / tests, and must NOT flag the format.ts helpers.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function makeEslint(): ESLint {
  return new ESLint({ cwd: repoRoot, overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs') });
}

async function lint(code: string, rel: string): Promise<string[]> {
  const eslint = makeEslint();
  const [res] = await eslint.lintText(code, { filePath: path.join(repoRoot, rel) });
  return (res?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

describe('format.ts lint rule', () => {
  it('flags toLocaleTimeString in app code', async () => {
    const msgs = await lint('export const f = (d: Date): string => d.toLocaleTimeString();', 'apps/desktop/src/main/x.ts');
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join(' ')).toContain('toLocaleTimeString');
  });

  it('flags toLocaleDateString and luxon toFormat', async () => {
    const code = [
      "import { DateTime } from 'luxon';",
      'export const a = (d: Date): string => d.toLocaleDateString();',
      "export const b = (): string => DateTime.now().toFormat('h:mm a');",
    ].join('\n');
    const msgs = await lint(code, 'apps/desktop/src/renderer/x.ts');
    expect(msgs.some((m) => m.includes('toLocaleDateString'))).toBe(true);
    expect(msgs.some((m) => m.includes('toFormat'))).toBe(true);
  });

  it('does NOT flag the format.ts helpers themselves', async () => {
    const code = "export const t = (d: { toFormat: (f: string) => string }): string => d.toFormat('yyyy');";
    const msgs = await lint(code, 'packages/shared/src/format.ts');
    expect(msgs).toEqual([]);
  });
});
