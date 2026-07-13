# HUMAN TODO

Items below are truly human-only (account logins, payments, certificates, physical acoustics).
Everything else has been done or self-verified by the agent.

## Manual verification script — palette & keys (0.6)
The agent already smoke-verified boot + an end-to-end turn programmatically
(`APOLLO_SMOKE=1 pnpm dev` prints `SMOKE_OK … e2e=turn-ok`). What remains human
is look-and-feel only:
- [ ] `pnpm dev` (unset ELECTRON_RUN_AS_NODE if your shell sets it): tray dot appears; Option+Space toggles the palette.
- [ ] Type "set a timer for 5 minutes": reply appears instantly (fast path) with a live countdown card; Cancel works.
- [ ] Type "what time is it": template reply, no LLM.
- [ ] Any other question shows the "There's a problem with your Anthropic key" copy until a key is added (expected before 0.7).
- [ ] Tray > Settings… > Keys: paste each key, press Test, see a green "Key works." line. Values are write-only (field clears).

## Live-audio checklist (Phase 2) — requires a real room mic + speakers
Everything the agent could automate is covered by `debug.injectAudio` (WAV → wake → listen → EOT),
the FakeSTT-driven VoiceController FSM suite, and the TTS→STT round-trip. These four items
physically require a microphone in a room and human ears, so they remain human:
- [ ] Wake: say "Hey Apollo" (or the dev keyword "jarvis" until a .ppn is trained) and confirm the orb expands with the wake earcon.
- [ ] Barge-in under music: while Apollo is speaking with background music playing, speak over it and confirm TTS stops within ~100ms and it starts listening.
- [ ] No self-trigger: confirm Apollo does not wake itself from its own TTS output (gated threshold works).
- [ ] Mute verification: toggle mute (tray/orb); confirm capture fully stops (no partials appear) and unmute restores listening.
- [ ] PTT: press the hotkey and confirm it enters listening without a wake word.

## API keys (app runs with Fake adapters until provided)
- [ ] Anthropic API key: create at https://console.anthropic.com/settings/keys, then either set `ANTHROPIC_API_KEY` in `apollo/.env` or paste into Settings > Keys and press Test.
  - [ ] After adding the key, run `pnpm eval` from the repo root — the 0.7 gate requires >= 90% pass rate (50 rows). The harness machinery is already self-verified; only the real-model run needs the key.
- [ ] Deepgram API key (STT): https://console.deepgram.com/ → API Keys. Set `DEEPGRAM_API_KEY` in `.env` or Settings > Keys.
- [ ] Picovoice access key (wake word): https://console.picovoice.ai/ → AccessKey. Set `PICOVOICE_ACCESS_KEY`. Optional: train a "Hey Apollo" keyword on the console and save as `apps/desktop/resources/hey_apollo.ppn` (until then the dev wake word is "jarvis").
- [ ] Brave Search API key: https://api-dashboard.search.brave.com/ → set `BRAVE_API_KEY`.
- [ ] Google OAuth client (Gmail, Phase 3): create an installed-app OAuth client at https://console.cloud.google.com/apis/credentials with scopes gmail.readonly and gmail.send; set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
