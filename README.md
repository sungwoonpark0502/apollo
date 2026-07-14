# Apollo

An always-available desktop AI assistant. A small orb docks at the edge of your
screen; activate it by saying **"Hey Apollo"** or pressing the global hotkey
(**Option+Space** on macOS, **Alt+Space** on Windows), then speak or type any
request — calendar, reminders, timers, alarms, notes, todos, email, news,
weather, web questions, opening apps, system control. Voice and text are equal:
everything you can do by voice you can do by text.

Local-first: all your data lives in a local SQLite database. Apollo only reaches
the network for the allowlisted hosts shown in **Settings → Privacy**.

## Requirements

- **Node 20+** (developed on Node 22) and **pnpm 10+**
- **macOS** or **Windows** (primary dev target is the current machine's OS)
- Python 3 + Xcode Command Line Tools (macOS) for building `better-sqlite3`

## Quick start (development)

```bash
pnpm install
pnpm dev            # launches the tray app + palette
```

> If your shell sets `ELECTRON_RUN_AS_NODE` (some CI/agent shells do), unset it for
> dev: `env -u ELECTRON_RUN_AS_NODE pnpm dev`.

On first run, a 4-step onboarding walks you through permissions and keys. Without
any keys, Apollo still runs on **Fake adapters**: timers, notes, calendar,
reminders, the fast path, and text replies all work locally; networked and
LLM-backed features show a clear "add a key" message until you provide one.

Press the hotkey and type **"set a timer for 5 minutes"** to see a live card.

## Keys (Settings → Keys, or a `.env` at the repo root)

Keys are stored write-only, encrypted with the OS keychain via Electron
`safeStorage`; the renderer can set and test them but never read them.

| Provider | Env var | Purpose | Required |
|----------|---------|---------|----------|
| Anthropic | `ANTHROPIC_API_KEY` | the LLM brain | yes (for anything beyond the fast path) |
| Deepgram | `DEEPGRAM_API_KEY` | speech-to-text | for voice input |
| Picovoice | `PICOVOICE_ACCESS_KEY` | "Hey Apollo" wake word | optional (PTT works without it) |
| Brave | `BRAVE_API_KEY` | web search | optional |
| Google OAuth | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail | optional |

Model id comes from config key `anthropic.model` (default `claude-sonnet-4-6`),
overridable via `ANTHROPIC_MODEL`. See `.env.example`. Full setup steps for each
account are in **HUMAN_TODO.md**.

## Permissions (macOS)

- **Microphone** — to hear you (requested during onboarding).
- **Accessibility** — for `screen.context` (active window + selected text).
  Grant in System Settings → Privacy & Security → Accessibility.

## Voice

- **Wake word**: "Hey Apollo" (dev builds fall back to the built-in "jarvis"
  keyword until a custom `resources/hey_apollo.ppn` is trained on the Picovoice
  console). **Push-to-talk** (the hotkey) always works with no wake engine.
- TTS defaults to the keyless `msedge-tts` voice `en-US-JennyNeural`
  (configurable in Settings → Voice).

## Three surfaces, one brain

Apollo has three ways in, all reading and writing the **same** local repos:

- **Orb** (voice) — docked at the screen edge; wake word or push-to-talk. Voice
  answers for weather, news, briefs, and schedules render on the **Response
  Stage**: a wider translucent panel with staggered rows, a temperature count-up,
  and a best-effort accent bar on the line being spoken. "Open in Apollo"
  deep-links into the Workspace.
- **Palette** (text) — the global-hotkey command bar for quick typed requests.
- **Workspace** — a full window (tray click, orb menu, `app.open`, or a card deep
  link). **Today** (up-next, schedule, reminders, todos, weather, latest brief),
  **Calendar** (Month / Week with drag create-move-resize / Agenda; recurring
  edits prompt *this event* vs *all events*), and **Notes** (FTS search,
  autosave, pin, delete-with-undo).

Because voice tools, the palette, and the Workspace all mutate the same repos,
changes propagate live: an event created by voice appears in an open Calendar
within one event-loop tick (a `DataBus` broadcasts `data.changed` to every
window). Settings edits broadcast the same way — no restart to change units,
time format, week start, or profile.

## Proactive nudges (quiet by design)

Apollo also notices things in your **own local data** and offers a small, polite
nudge — a meeting starting soon, overdue to-dos, a busy tomorrow, stale email
threads, rain before an event. Every rule is deterministic and local: **no LLM
calls and no new network egress**. A **governor** enforces the Quiet invariant in
code before anything reaches you: a per-day budget, Do-Not-Disturb hours,
de-duplication, 20-minute spacing, deferral while you're talking or in
fullscreen, batching into one card, and **auto-tune** (if you dismiss a rule's
nudges five times, it offers to turn that rule off). Time-sensitive nudges are
exempt from the budget but still respect DND (delivered silently). Turn any rule
on/off by voice ("stop reminding me about meetings") or in **Settings →
Proactive**.

## Quick Capture

A global-hotkey micro-window (**Ctrl/Cmd+Shift+N**) saves a thought as a note,
to-do, or reminder in under two seconds, **with zero LLM involvement**. It
classifies as you type — a future time turns it into a reminder (with the time
phrase stripped), a leading `todo` or trailing `!` forces a to-do — and Tab
cycles the type. It saves through the same repos, so a captured note is live in
the Workspace and available to voice instantly, and it works fully offline.

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | run the app in development |
| `pnpm -r typecheck` | TypeScript strict check across packages |
| `pnpm lint` | ESLint (no `any`, no `console`, hook rules) |
| `pnpm -r test` | all unit/integration suites (Vitest) |
| `pnpm eval` | agent eval harness against the real LLM (skips without a key) |
| `pnpm --filter @apollo/desktop package` | build installable artifacts into `apps/desktop/release/` |

Tests run under the Node ABI and dev/packaging under the Electron ABI; the
`native-abi.mjs` script swaps `better-sqlite3`'s binary automatically via the
`pretest`/`predev`/`prepackage` hooks.

## Architecture map

```
apollo/
  packages/shared/         cross-module contracts (types, zod schemas, strings, IPC table)
  apps/desktop/
    src/main/              Electron main process
      index.ts             composition root: wires everything below
      ipc/                 generic zod-validated IPC router + handlers
      agent/               orchestrator (hand-written loop), fast path, time resolver,
                           taint + confirmation gates, system prompt, LLM adapters
      tools/               the tool catalog (calendar, timers, email, weather, brief, …)
                           + registry; every tool ships tests beside it
      voice/               VoiceController FSM, Deepgram/Fake STT, edge/Fake TTS, chunker
      audio-worker/        utilityProcess: wake adapters + Silero VAD
      db/                  better-sqlite3 connection, numbered migrations, repos (only SQL),
                           DataBus (live cross-surface sync)
      net/                 httpClient + egress allowlist + circuit breaker + offline probe
      security/            secrets (safeStorage), email sanitizer, Gmail OAuth + provider
      scheduler/           timer/reminder/alarm scheduler + daily brief
      proactive/           deterministic rules + governor (Quiet pipeline) + engine + controller
      quickCapture/        classifier + save-path service (note/todo/reminder, zero LLM)
      workspace/           Today-view data provider (weather strip + latest brief)
    src/preload/           the single typed window.apollo bridge
    src/renderer/          orb, palette, workspace, settings, onboarding, audio windows
                           (React + zustand); lib/ holds pure calendar/stage/debounce logic
  eval/                    golden.jsonl (agent eval), injection/ (prompt-injection suite)
```

### How a turn flows

1. **Renderer** sends `agent.userMessage` over the one preload bridge.
2. **IPC router** validates the payload with zod and verifies the sender frame.
3. **Orchestrator** tries the **fast path** (C9) — pure templates, no LLM. On a
   miss it streams from Anthropic with the full tool set.
4. Tool-use blocks are validated, executed (Tier 1/2 in parallel), and their
   results fed back. **Tier 3** actions (e.g. `email.send`) are **code-gated**
   behind a confirmation that no prompt can disable; untrusted content taints the
   turn and flags unstated recipients/URLs/paths red in the confirm card.
5. Sentences stream to **TTS**; the orb plays audio and shows compact cards.

## Security posture (highlights)

- Every window: `contextIsolation`, `sandbox`, `nodeIntegration:false`, strict CSP.
- Secrets never touch the renderer, disk in plaintext, or the logs (pino redaction).
- No `child_process.exec`; OS commands are fixed templates with validated args
  via `spawn(shell:false)` (CI grep-gate enforces this).
- Prompt-injection defense is structural (Tier 3 gate + taint + `<data>` wrapping)
  and covered by a 100%-required injection suite.
- Network egress is restricted to a verbatim allowlist shown in Settings → Privacy.

## Status & remaining human steps

Everything the agent could build and self-verify is done and tested. The only
open items require a human account, payment, certificate, or a physical
microphone — they are listed precisely in **HUMAN_TODO.md**. Design and
implementation decisions are logged in **DECISIONS.md**; milestone status in
**PROGRESS.md**.
