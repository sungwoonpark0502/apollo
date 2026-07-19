import { describe, expect, it } from 'vitest';
import { availableModels, isKnownModel, PROVIDER_CATALOG, providerInfo, resolveModelChoice } from './providerCatalog';

describe('provider catalog', () => {
  it('covers all three providers with at least one model each', () => {
    expect(PROVIDER_CATALOG.map((p) => p.id).sort()).toEqual(['anthropic', 'google', 'openai']);
    for (const p of PROVIDER_CATALOG) expect(p.models.length).toBeGreaterThan(0);
  });

  it('every default model is in its own provider list', () => {
    // A default outside the list would make resolveModelChoice emit an id the
    // translation layer has never been tested with.
    for (const p of PROVIDER_CATALOG) {
      expect(isKnownModel(p.id, p.defaultModel), p.id).toBe(true);
    }
  });

  it('keeps the Phase 0-12 Anthropic default, so existing users see no change', () => {
    expect(providerInfo('anthropic').defaultModel).toBe('claude-sonnet-4-6');
  });

  it('resolveModelChoice honors a known pick and clamps an unknown one', () => {
    expect(resolveModelChoice('anthropic', 'claude-opus-4-8')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
    expect(resolveModelChoice('anthropic', 'made-up')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(resolveModelChoice('openai', null)).toEqual({ provider: 'openai', model: 'gpt-5' });
  });

  it('a model id is never valid across the wrong provider', () => {
    expect(isKnownModel('openai', 'claude-sonnet-4-6')).toBe(false);
    expect(resolveModelChoice('google', 'gpt-5').model).toBe('gemini-2.5-flash');
  });

  it('availableModels filters to the configured subset, preserving order', () => {
    expect(availableModels(['google']).providers.map((p) => p.id)).toEqual(['google']);
    expect(availableModels(['google', 'anthropic']).providers.map((p) => p.id)).toEqual(['anthropic', 'google']);
    expect(availableModels([]).providers).toEqual([]);
  });
});
