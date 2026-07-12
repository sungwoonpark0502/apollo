/**
 * Every user-facing string lives here (A5). No user-facing literals inline in
 * components or tools. Interpolated strings are functions.
 */
export const STRINGS = {
  app: {
    name: 'Apollo',
    tray: { open: 'Open Apollo', settings: 'Settings…', mute: 'Mute microphone', unmute: 'Unmute microphone', quit: 'Quit Apollo' },
    palettePlaceholder: 'Ask Apollo…',
  },

  errors: {
    KEY_MISSING: (provider: string) => `There's a problem with your ${provider} key. Check Settings > Keys.`,
    KEY_INVALID: (provider: string) => `There's a problem with your ${provider} key. Check Settings > Keys.`,
    RATE_LIMITED: "That service is busy right now. I'll be ready to retry in a moment.",
    OFFLINE: (unavailable: string, works: string) => `I'm offline, so I can't fetch ${unavailable}. ${works} still works.`,
    STT_DOWN: 'My hearing is acting up. You can keep typing to me.',
    TTS_DOWN: "I lost my voice for a moment; I'll answer as text and cards until it's back.",
    LLM_DOWN: "My brain's connection is down. Timers, notes, and your calendar still work locally.",
    TOOL_FAIL: (doing: string) => `I hit a snag while ${doing}. Want me to try again?`,
    TIMEOUT: 'That was taking too long, so I stopped it.',
    CANCELED: '',
    INTERNAL: 'Something went wrong on my end. Mind trying that again?',
  },

  confirm: {
    ask: (summary: string) => `${summary} — should I?`,
    askShort: 'Send it?',
    approve: 'Approve',
    deny: 'Deny',
    canceled: 'Canceled.',
    denied: "Okay, I won't.",
    expired: 'That confirmation expired, so I did nothing.',
    superseded: 'Replaced by a newer request.',
    cancelWindow: (s: number) => `Sending in ${s}…`,
    cancelNow: 'Cancel',
    emailSummary: (to: string, subject: string) => `Send email to ${to}: "${subject}"`,
    taintWarning: (arg: string) => `The ${arg} did not come from you — double-check it.`,
  },

  cards: {
    pin: 'Pin',
    unpin: 'Unpin',
    delete: 'Delete',
    edit: 'Edit',
    cancel: 'Cancel',
    send: 'Send',
    loadImages: (n: number) => `Load images (${n})`,
    moreEvents: (n: number) => `+${n} more`,
    to: 'To',
    subject: 'Subject',
    unread: 'Unread',
    today: 'Today',
    tomorrow: 'Tomorrow',
    allDay: 'All day',
  },

  spoken: {
    timerSet: (label: string) => `Timer set for ${label}.`,
    timerDone: (label: string | null) => (label ? `Your ${label} timer is done.` : 'Your timer is done.'),
    timerCanceled: 'Timer canceled.',
    alarmFired: (label: string | null) => (label ? `Alarm: ${label}.` : "It's time."),
    reminderFired: (text: string) => `Reminder: ${text}.`,
    timeNow: (time: string) => `It's ${time}.`,
    dateToday: (date: string) => `Today is ${date}.`,
    appOpened: (app: string) => `Opening ${app}.`,
    appNotFound: (candidates: string[]) => `I couldn't find that app. Closest matches: ${candidates.join(', ')}.`,
    volumeSet: (pct: number) => `Volume ${pct} percent.`,
    muted: 'Muted. Tap the orb or press the hotkey when you need me.',
    unmuted: "I'm listening again.",
    stoppedTalking: 'Okay.',
    undone: (what: string) => `Undone: ${what}.`,
    nothingToUndo: 'There is nothing to undo in this conversation.',
    whileAway: (n: number) => `While you were away: ${n} ${n === 1 ? 'item' : 'items'}.`,
    briefIntro: 'Here is your brief.',
  },

  onboarding: {
    welcomeTitle: 'Meet Apollo',
    welcomeBody: 'A quiet assistant that lives at the edge of your screen. Talk to it, or type.',
    permissionsTitle: 'Two permissions',
    permissionsBody: 'Apollo needs the microphone to hear you, and accessibility to see the active window. Both stay on this Mac.',
    keysTitle: 'Connect your keys',
    keysBody: 'Anthropic and Deepgram keys are required. The others unlock extras and can wait.',
    finishTitle: "You're set",
    finishBody: (hotkey: string) => `Try: press ${hotkey} and type "set a timer for 5 minutes".`,
    next: 'Next',
    back: 'Back',
    done: 'Finish',
    test: 'Test',
  },

  settings: {
    tabs: { general: 'General', voice: 'Voice', accounts: 'Accounts', keys: 'Keys', privacy: 'Privacy', diagnostics: 'Diagnostics' },
    general: { launchAtLogin: 'Launch at login', hotkey: 'Global hotkey', orbEdge: 'Orb edge', homeLocation: 'Home location' },
    voice: { wake: 'Wake word', sensitivity: 'Sensitivity', ptt: 'Push to talk', voice: 'Voice', preview: 'Preview', dnd: 'Do not disturb' },
    accounts: { gmail: 'Gmail', connect: 'Connect', disconnect: 'Disconnect', connectedAs: (a: string) => `Connected as ${a}` },
    keys: {
      title: 'API keys',
      test: 'Test',
      ok: 'Key works.',
      bad: (msg: string) => `Key failed: ${msg}`,
      providers: { anthropic: 'Anthropic', deepgram: 'Deepgram', brave: 'Brave Search', picovoice: 'Picovoice' },
    },
    privacy: {
      history: 'Keep conversation history',
      memoryFacts: 'Remembered facts',
      egress: 'Apollo only ever talks to these hosts:',
      approvedDirs: 'Folders Apollo may search',
      wipe: 'Wipe all data',
      wipeConfirmPrompt: 'Type ERASE to delete everything.',
      wipeConfirmWord: 'ERASE',
    },
    diagnostics: { perf: 'Latency (ms)', adapters: 'Adapters', logs: 'Recent log', copy: 'Copy diagnostics' },
  },

  notifications: {
    whileAwayTitle: 'While you were away',
    voiceDisabled: 'Voice is disabled after repeated audio errors. Text still works.',
    updateReady: 'An update is ready. It will apply on next launch.',
  },

  fastPath: {
    unsupportedAlternative: (nearest: string) => `I can't do that yet, but I can ${nearest}.`,
  },
} as const;

export type Strings = typeof STRINGS;
