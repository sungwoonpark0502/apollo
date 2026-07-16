import { describe, expect, it } from 'vitest';
import { STRINGS } from '@apollo/shared';
import { buildEvalTools } from '../../../../../eval/toolCatalog';

// I5: the friendly tool-activity label map must cover every registered tool
// with a specific (non-generic) phrase, and never leak a raw tool name.
describe('tool-activity label map', () => {
  const names = buildEvalTools([]).map((t) => t.name);

  it('covers every registered tool with a specific label', () => {
    const uncovered = names.filter((n) => STRINGS.toolActivity(n) === STRINGS.toolActivityGeneric);
    expect(uncovered, `tools missing a friendly label: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('never surfaces the raw tool name and always ends in an ellipsis', () => {
    for (const n of names) {
      const label = STRINGS.toolActivity(n);
      expect(label).not.toContain(n);
      expect(label.endsWith('…')).toBe(true);
    }
  });

  it('falls back to the generic label for an unknown tool', () => {
    expect(STRINGS.toolActivity('quantum.entangle')).toBe(STRINGS.toolActivityGeneric);
  });
});
