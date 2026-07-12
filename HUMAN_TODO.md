# HUMAN TODO

Items below are truly human-only (account logins, payments, certificates, physical acoustics).
Everything else has been done or self-verified by the agent.

## API keys (app runs with Fake adapters until provided)
- [ ] Anthropic API key: create at https://console.anthropic.com/settings/keys, then either set `ANTHROPIC_API_KEY` in `apollo/.env` or paste into Settings > Keys and press Test.
- [ ] Deepgram API key (STT): https://console.deepgram.com/ → API Keys. Set `DEEPGRAM_API_KEY` in `.env` or Settings > Keys.
- [ ] Picovoice access key (wake word): https://console.picovoice.ai/ → AccessKey. Set `PICOVOICE_ACCESS_KEY`. Optional: train a "Hey Apollo" keyword on the console and save as `apps/desktop/resources/hey_apollo.ppn` (until then the dev wake word is "jarvis").
- [ ] Brave Search API key: https://api-dashboard.search.brave.com/ → set `BRAVE_API_KEY`.
- [ ] Google OAuth client (Gmail, Phase 3): create an installed-app OAuth client at https://console.cloud.google.com/apis/credentials with scopes gmail.readonly and gmail.send; set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
