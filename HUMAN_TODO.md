# HUMAN TODO

Items below are truly human-only (account logins, payments, certificates, physical acoustics).
Everything else has been done or self-verified by the agent.

## Phase 9 / I5 conversation polish — visual QA
Implemented and unit-covered where testable (tool-activity label map, retry-with-memory).
The following are wired but need a human eye on a running app (open the orb + palette, run a
few turns):
- Tool-activity line: while a tool runs, the orb and palette show a friendly line
  ("Checking your calendar…", "Reading that page…"), never a raw tool name; it clears on result.
- Interruptible thinking: a visible **Cancel** appears during the thinking state (orb + palette)
  and stops the generation for text-mode users.
- Streaming TTS controls (orb speaking state): **Stop** and **Replay-from-start** are wired.
  NOT yet implemented (deferred): **Skip sentence** and the "sentence i of n" progress line for
  long (>6 sentence) replies — these need per-sentence buffering in the audio player.
- Copy/share: palette reply copy (existing), Notes "Copy" (text), event card "Copy as ICS".
  A generic copy affordance on Stage/orb cards other than events is NOT yet added (deferred).
Confirm these read well and the deferred items are acceptable or file follow-ups.

## Phase 10 / J5.5 packaged-build security re-verification (needs CI packaging)
The fuse config and permission-lockdown logic are unit-tested and green. What needs a real packaged
build (electron-builder), which this environment can't produce (and Windows needs Windows CI):
- Run `pnpm --filter @apollo/desktop package` on macOS and Windows; confirm it emits installable
  artifacts (.dmg/.zip, .exe/.nsis).
- Fuse **readback** on the packaged binary: verify EnableNodeCliInspectArguments=off,
  OnlyLoadAppFromAsar=on, RunAsNode=off, EnableNodeOptionsEnvironmentVariable=off, cookie encryption on.
- Permission-denial on the built app: mic/accessibility prompts behave; the default session denies
  geolocation/notifications/openExternal except where explicitly allowed; the audio session allows only media.
- Egress in the packaged app: observe that only the C14.9 allowlist hosts (+ www.googleapis.com) are ever contacted.

## Phase 10 / J6.4 copy & tone review (subjective)
`strings-inventory.md` (generated, 477 strings) is the full inventory of user-facing copy. Give it a
C10/C18 tone pass: sentence case, no corporate filler, present tense, warm-but-brief. Flag any stragglers
that read as robotic or inconsistent. The centralization itself is enforced (all copy lives in strings.ts).

## Phase 10 / J6.5 accessibility checklist (keyboard + screen reader)
Structural a11y is in place (aria-labels centralized, focus-visible, voice-state announced). Do a manual
pass on each interactive surface:
- **Keyboard-only traversal** of every window/overlay: Palette, Orb nudge/ring cards, Workspace (Today/
  Calendar/Week/Agenda/Notes/Chats/Omnisearch), Settings (all tabs incl. Calendars/Accounts), Onboarding,
  Quick Capture, the shortcuts help sheet, batch-confirm & sync-conflict cards. Tab order sane, no traps,
  Esc closes overlays.
- **Screen-reader announcements**: voice state (listening/thinking/speaking/follow-up), alert ringing,
  nudge arrival, and confirmation prompts are announced; cards expose their text.
- **Contrast & focus rings** in both light and dark themes.

## Phase 9 / I6 empty states, onboarding, help — visual QA
Structural pieces are done and tested (shortcuts registry single-source + help sheet, welcome-note
seed, first-nudge explainer flag, keys-skipped banner, onboarding step indicator + sample-note opt-in).
Give these a human pass on a running app:
- Shortcuts help sheet: press `?` or Cmd/Ctrl+/ in the Workspace — every binding shown matches actual
  behavior (they share the registry); scopes grouped Global/Workspace/Calendar/Notes/Voice.
- Onboarding: run it fresh — "Step i of 6" indicator, Back preserves entered values, the sample-note
  checkbox (default on) seeds a real welcome note, finish lands on Today; skip keys → the dismissible
  banner appears in the Workspace.
- First proactive nudge ever: the one-time explainer note appears above it, then never again.
- Omnisearch: before typing shows recent notes; a no-match query offers "Create a note: …".
- Empty states NOT yet re-copyedited (still functional, basic wording): Today, Calendar, Notes, Chats
  primary empty states could get the warmer one-liners the spec describes — low priority follow-up.

## Phase 9 / I7 Google Calendar sync — live account required
The sync engine, mapping, conflict handling, disconnect, offline queue, and opt-in-inert behavior are
fully implemented and unit-tested against a **mocked** Google client (no account needed to reach green).
What genuinely needs a human + a real Google account:
- **Live incremental auth.** `getCalendarToken()` in index.ts returns null (so the module stays inert and
  safe). Wire the calendar-scope PKCE grant: reuse the installed-app flow, request
  `https://www.googleapis.com/auth/calendar` at connect time (incremental — Gmail scopes untouched),
  store the token via safeStorage in a separate account row, and implement `revoke()` against
  oauth2.googleapis.com/revoke. Until then "Connect Google Calendar" in Settings > Accounts shows a
  "not set up on this build" message.
- **End-to-end verification** against a real calendar: connect, pick calendars + direction, confirm pull
  (incremental token, recurrence, timezones), two-way push with etag, a real conflict (edit the same
  event in two places) → the conflict card, disconnect keep-vs-remove, and offline queue flush.
- **Editor cross-boundary move**: the atomic move (delete-here + create-there, queuing remote ops) is
  implemented and tested in the engine (`moveEvent`), but the event editor's calendar picker currently
  just changes calendar_id; wiring the picker to call the engine move for local↔synced transitions is a
  follow-up.
- Egress note: I7 added `www.googleapis.com` (Calendar API) to the allowlist — a first-party Google host,
  no wildcard. Confirm this is acceptable (see DECISIONS).

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

## Proactive nudges — visual/behavioral QA (Phase 6 / Part F — logic is unit-tested)
The governor's Quiet pipeline (budget, DND, dedupe, spacing, fullscreen deferral, batching, auto-tune)
is fully covered by the fake-clock governor suite. What benefits from a human looking:
- [ ] A meeting nudge appears ~10 min before an event with the nudge chime (quieter than wake), an accent dot on the idle orb, and an OS notification; Snooze/Dismiss work.
- [ ] Grouped digest: several nudges arriving together render as one card with per-item actions.
- [ ] Auto-tune: after dismissing a rule's nudges 5 times, the next one becomes "Want me to stop … ?" with Yes/Keep.
- [ ] **Cross-app fullscreen detection is a stub** (`isFullscreen: () => false`): Electron exposes no reliable way to detect that *another* app is fullscreen, so non-time-sensitive nudges are NOT currently deferred during someone else's fullscreen presentation. To honor F3.2 step 6 fully, wire a native check (macOS: `CGDisplayIsActive`/private Spaces API or a helper; Windows: `SHQueryUserNotificationState`) into that callback. The governor already defers correctly once the callback returns true (proven by the governor suite).

## Workspace visual QA (Phase 5 / Part E — human eyes; logic is unit-tested)
The Workspace data flow, calendar math, and one-brain live sync are all covered by
automated tests + the boot smoke (wsRendered=true). What needs a human looking at pixels:
- [ ] Calendar Week view: drag on empty space creates an event snapped to 15 min; drag a chip to move it; drag its bottom edge to resize. Confirm each persists and survives a reload.
- [ ] Overlapping events in Week view tile side-by-side without gaps (lane layout).
- [ ] Response Stage animations: brief/news/weather voice answers fade+rise in, rows stagger, weather temp counts up; the spoken-row accent bar tracks the sentence being read.
- [ ] Dark mode: toggle OS appearance and confirm every Workspace surface (Today, Month/Week/Agenda, Notes, modals) reads correctly.
- [ ] Reduced motion: enable "Reduce motion" and confirm Stage collapses to a plain fade and the waveform/scale transitions are disabled.

## Packaging & updates (code-signing / distribution — real accounts required)
The build itself is verified: `pnpm --filter @apollo/desktop package` produced `release/Apollo-0.1.0-arm64.dmg` (182 MB, unsigned). To ship signed/auto-updating builds:
- [ ] Apple Developer account + Developer ID Application certificate; set `CSC_LINK`/`CSC_KEY_PASSWORD`, flip `notarize: true` in electron-builder.yml, and provide `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` for notarization.
- [ ] Windows code-signing certificate for the nsis target (set `CSC_LINK`/`CSC_KEY_PASSWORD` on a Windows/CI runner).
- [ ] Update feed: replace `publish.url` in electron-builder.yml with your real HTTPS bucket and publish `latest*.yml` + artifacts there so electron-updater can find them.
- [ ] App icons: add `resources/icon.icns` (mac) and `resources/icon.ico` (win); currently the default Electron icon is used.

## Semantic memory model (Phase 7 / Part G — on-device embeddings)
Recall works on a Fake embedder out of the box; for real semantic search, fetch the
model **once at build time** (it is never downloaded at runtime):
- [ ] Run `pnpm --filter @apollo/desktop fetch-models` (needs network). It saves
  `apps/desktop/resources/models/minilm/{config.json, tokenizer.json, tokenizer_config.json, onnx/model_quantized.onnx}`
  from https://huggingface.co/Xenova/all-MiniLM-L6-v2 and prints SHA-256 hashes (recorded in DECISIONS.md).
  If the machine is offline, download those four files manually from that repo into that exact folder.
- [ ] Semantic-quality eyeball (real model): seed ~10 notes, run the 10 scripted recall queries in
  eval/recall_queries.txt, and confirm the top-1 result is sensible. (Machine ranking tests already pass on FakeEmbedder.)
- [ ] Omnisearch keyboard nav (Cmd/Ctrl+K in the Workspace): type a query, confirm Notes/Events/Facts groups
  populate, arrow keys move the highlight across groups, Enter opens the selected item (note → Notes view,
  event → Calendar at its date, fact → Settings > Privacy), and Esc closes. (IPC round-trips are unit-tested.)

## Alerts manual QA (Phase 8 / H6 — needs a real firing timer + speakers)
- [ ] Set a 1-minute timer; when it fires, the orb shows a ringing card (large label, elapsed counter), ring.wav loops, and the loop auto-stops after 60s while the card stays. Dismiss and Snooze (1/5/10m) both work; snooze re-fires after the chosen minutes.
- [ ] Set an alarm; it rings until dismissed/snoozed, with the volume audibly stepping down every minute.
- [ ] During the DND window, a fired timer/alarm shows the card + OS notification but plays no sound ("Silenced" note visible).
- [ ] Clicking the OS notification focuses the ringing card (reminders open Workspace Today).

## Voice/system manual QA (Phase 8 / H7 — device + OS behaviors)
- [ ] Settings > Voice: pick a non-default microphone and speaker; confirm capture/playback follow the choice; unplug the device and confirm Apollo falls back to system default with a one-time notice.
- [ ] Speech rate slider changes TTS speed; Sound volume slider changes earcon loudness (0 mutes).
- [ ] Bind the hotkey to a combo already in use → inline conflict error names the conflict and suggests an alternative; app keeps working.
- [ ] Launch a second instance → the existing Workspace/palette focuses and the second process exits.
- [ ] Enable "Pause wake word on battery", unplug AC → wake word stops (PTT still works), orb shows the badge; replug → wake resumes.
- [ ] (Packaged only) When an update finishes downloading, About + tray show "Restart to update {version}"; it never auto-restarts.

## Performance measurement (Phase 8 / H8 — measured, not a hard CI gate)
- [ ] Idle RSS: open Settings > Diagnostics > Resources after ~1 min idle; note main/worker/renderer RSS. If it grows >20% across a phase, record it in DECISIONS.md. (Boot budget boot_to_tray p95 < 2500ms is machine-checked by `pnpm --filter @apollo/desktop boot-bench`; measured 262ms.)

## Windows platform QA (Phase 8 / H9 — CI builds Windows but can't drive the UI)
- [ ] Hotkey: default Alt+Space vs the system window menu — confirm the conflict advice appears and pick Ctrl+Alt+Space.
- [ ] Acrylic: palette + Quick Capture windows show the acrylic backdrop.
- [ ] Notifications: timer/alarm/reminder fire native Windows notifications; clicking routes correctly.
- [ ] Ringing overlay appears above fullscreen apps; sound plays; snooze/dismiss work.
- [ ] Single instance: launching a second copy focuses the existing window and exits.

## API keys (app runs with Fake adapters until provided)
- [ ] Anthropic API key: create at https://console.anthropic.com/settings/keys, then either set `ANTHROPIC_API_KEY` in `apollo/.env` or paste into Settings > Keys and press Test.
  - [ ] After adding the key, run `pnpm eval` from the repo root — the 0.7 gate requires >= 90% pass rate (50 rows). The harness machinery is already self-verified; only the real-model run needs the key.
- [ ] Deepgram API key (STT): https://console.deepgram.com/ → API Keys. Set `DEEPGRAM_API_KEY` in `.env` or Settings > Keys.
- [ ] Picovoice access key (wake word): https://console.picovoice.ai/ → AccessKey. Set `PICOVOICE_ACCESS_KEY`. Optional: train a "Hey Apollo" keyword on the console and save as `apps/desktop/resources/hey_apollo.ppn` (until then the dev wake word is "jarvis").
- [ ] Brave Search API key: https://api-dashboard.search.brave.com/ → set `BRAVE_API_KEY`.
- [ ] Google OAuth client (Gmail, Phase 3): create an installed-app OAuth client at https://console.cloud.google.com/apis/credentials with scopes gmail.readonly and gmail.send; set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
