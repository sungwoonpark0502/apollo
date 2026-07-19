import React, { useEffect, useState } from 'react';
import { resolveModelChoice, STRINGS, type AvailableModels, type LlmProviderId, type Settings } from '@apollo/shared';

/**
 * The provider/model selector in the composer footer, ChatGPT/Claude style.
 * The choice persists in settings.chat and applies from the NEXT turn — a turn
 * in flight keeps the brain it started with.
 *
 * Options come from `chat.models`: the backend's real key inventory in managed
 * mode, Anthropic-only in BYOK. A single-provider install renders the picker
 * with one group rather than hiding it, so the model choice is still there.
 */
export function ModelPicker({ settings, onPatch }: { settings: Settings; onPatch: (next: Settings) => void }): React.JSX.Element | null {
  const [avail, setAvail] = useState<AvailableModels | null>(null);

  useEffect(() => {
    void window.apollo.call('chat.models', {}).then(setAvail);
  }, []);

  if (!avail || avail.providers.length === 0) return null;

  // The stored pick may name a provider this install cannot serve (settings
  // synced from elsewhere); show what will actually be used.
  const active = avail.providers.find((p) => p.id === settings.chat.provider) ?? avail.providers[0]!;
  const { model } = resolveModelChoice(active.id, settings.chat.model);
  const value = `${active.id}:${model}`;

  const onChange = (next: string): void => {
    const [provider, modelId] = next.split(':') as [LlmProviderId, string];
    onPatch({ ...settings, chat: { ...settings.chat, provider, model: modelId } });
  };

  return (
    <select
      className="apollo-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={STRINGS.workspace.chat.modelPicker}
      title={STRINGS.workspace.chat.modelPicker}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-ctl)',
        background: 'var(--surface)',
        color: 'var(--text-2)',
        fontSize: 'var(--fs-caption)',
        fontFamily: 'var(--font-sans)',
        padding: '2px var(--sp-2)',
        maxWidth: 190,
      }}
    >
      {avail.providers.map((p) => (
        <optgroup key={p.id} label={p.label}>
          {p.models.map((m) => (
            <option key={m.id} value={`${p.id}:${m.id}`}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
