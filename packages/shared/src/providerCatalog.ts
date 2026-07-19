import { z } from 'zod';

/**
 * The chat provider/model catalog, shared by the backend (which validates and
 * dispatches), the desktop client (which renders the picker), and the web
 * client. One table so a model the picker offers is always a model the backend
 * accepts — the two cannot drift.
 *
 * Model ids are pinned here rather than fetched live: a picker fed by a
 * provider's /models endpoint offers whatever the provider ships that week,
 * including models Apollo's tool-call translation has never been tested
 * against. New models are a deliberate one-line change with a test run behind
 * it. Verifying these ids against live provider docs at deploy time is in
 * HUMAN_TODO.
 */
export const llmProviderIdSchema = z.enum(['anthropic', 'openai', 'google']);
export type LlmProviderId = z.infer<typeof llmProviderIdSchema>;

export interface ModelInfo {
  /** The id sent to the provider. */
  id: string;
  /** What the picker shows. */
  label: string;
}

export interface ProviderInfo {
  id: LlmProviderId;
  label: string;
  models: ModelInfo[];
  defaultModel: string;
}

export const PROVIDER_CATALOG: readonly ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Claude',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    // Stays the Phase 0–12 default so nothing changes for existing users.
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    models: [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
    ],
    defaultModel: 'gpt-5',
  },
  {
    id: 'google',
    label: 'Gemini',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    defaultModel: 'gemini-2.5-flash',
  },
] as const;

export function providerInfo(id: LlmProviderId): ProviderInfo {
  // The enum guarantees presence; the non-null assertion is checked by a test.
  return PROVIDER_CATALOG.find((p) => p.id === id)!;
}

/** True when `model` is one this provider's translation layer has been tested with. */
export function isKnownModel(provider: LlmProviderId, model: string): boolean {
  return providerInfo(provider).models.some((m) => m.id === model);
}

/**
 * Resolves the picker state to a concrete (provider, model) pair. An unknown
 * model — e.g. a settings blob written by a newer build — falls back to the
 * provider default rather than sending an untested id upstream.
 */
export function resolveModelChoice(provider: LlmProviderId, model: string | null): { provider: LlmProviderId; model: string } {
  const info = providerInfo(provider);
  return { provider, model: model !== null && isKnownModel(provider, model) ? model : info.defaultModel };
}

/** The wire shape of GET /v1/models: which providers this deployment can serve. */
export const availableModelsSchema = z.object({
  providers: z.array(
    z.object({
      id: llmProviderIdSchema,
      label: z.string(),
      models: z.array(z.object({ id: z.string(), label: z.string() })),
      defaultModel: z.string(),
    }),
  ),
});
export type AvailableModels = z.infer<typeof availableModelsSchema>;

/** Catalog filtered to the providers a deployment actually holds keys for. */
export function availableModels(configured: readonly LlmProviderId[]): AvailableModels {
  return { providers: PROVIDER_CATALOG.filter((p) => configured.includes(p.id)) };
}
