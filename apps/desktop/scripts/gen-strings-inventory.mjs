import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regenerates strings-inventory.md from STRINGS (J6.4). The inventory backs the
 * C10/C18 tone review, so it has to track the real copy — it was hand-made once
 * and went stale the moment strings were added. Run it after touching
 * strings.ts: `node apps/desktop/scripts/gen-strings-inventory.mjs`.
 *
 * Template functions are recorded by shape rather than value: calling them with
 * fake arguments would put invented copy in a document meant for review.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const { STRINGS } = await import(join(REPO, 'packages/shared/src/strings.ts'));

const rows = [];
function walk(node, path) {
  for (const [key, value] of Object.entries(node)) {
    const at = path ? `${path}.${key}` : key;
    if (typeof value === 'string') rows.push([at, JSON.stringify(value)]);
    else if (typeof value === 'function') rows.push([at, `_(template, ${value.length} arg${value.length === 1 ? '' : 's'})_`]);
    else if (Array.isArray(value)) value.forEach((v, i) => (typeof v === 'string' ? rows.push([`${at}[${i}]`, JSON.stringify(v)]) : walk(v, `${at}[${i}]`)));
    else if (value && typeof value === 'object') walk(value, at);
  }
}
walk(STRINGS, '');

const literals = rows.filter(([, copy]) => !copy.startsWith('_(')).length;
const templates = rows.length - literals;

const body = [
  '# Strings Inventory (J6.4)',
  '',
  'Generated from packages/shared/src/strings.ts — the single source of user-facing copy (A5).',
  'Use this for the C10/C18 tone review (sentence case, no corporate filler, present tense).',
  '',
  'Regenerate with `node apps/desktop/scripts/gen-strings-inventory.mjs` after changing strings.ts.',
  '',
  `Total user-facing strings: ${rows.length} (${literals} literal, ${templates} templated)`,
  '',
  '| key | copy |',
  '|-----|------|',
  ...rows.map(([k, v]) => `| \`${k}\` | ${v.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');

writeFileSync(join(REPO, 'strings-inventory.md'), body);
console.log(`strings-inventory: ${rows.length} strings (${literals} literal, ${templates} templated)`);
