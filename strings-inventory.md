# Strings Inventory (J6.4)

Generated from packages/shared/src/strings.ts — the single source of user-facing copy (A5).
Use this for the C10/C18 tone review (sentence case, no corporate filler, present tense).

Regenerate with `node apps/desktop/scripts/gen-strings-inventory.mjs` after changing strings.ts.

Total user-facing strings: 625 (543 literal, 82 templated)

| key | copy |
|-----|------|
| `app.name` | "Apollo" |
| `app.tray.open` | "Open Apollo" |
| `app.tray.chat` | "Open chat" |
| `app.tray.quickCapture` | "Quick capture" |
| `app.tray.settings` | "Settings…" |
| `app.tray.mute` | "Mute microphone" |
| `app.tray.unmute` | "Unmute microphone" |
| `app.tray.quit` | "Quit Apollo" |
| `toolActivityGeneric` | "Working…" |
| `toolActivity` | _(template, 1 arg)_ |
| `errors.KEY_MISSING` | _(template, 1 arg)_ |
| `errors.KEY_INVALID` | _(template, 1 arg)_ |
| `errors.RATE_LIMITED` | "That service is busy right now. I'll be ready to retry in a moment." |
| `errors.OFFLINE` | _(template, 2 args)_ |
| `errors.STT_DOWN` | "My hearing is acting up. You can keep typing to me." |
| `errors.TTS_DOWN` | "I lost my voice for a moment; I'll answer as text and cards until it's back." |
| `errors.LLM_DOWN` | "My brain's connection is down. Timers, notes, and your calendar still work locally." |
| `errors.TOOL_FAIL` | _(template, 1 arg)_ |
| `errors.TIMEOUT` | "That was taking too long, so I stopped it." |
| `errors.CANCELED` | "" |
| `errors.INTERNAL` | "Something went wrong on my end. Mind trying that again?" |
| `errors.THROTTLED` | "That was too many requests at once. Give me a second." |
| `errors.REAUTH_NEEDED` | "I need you to reconnect your Google account in Settings > Accounts." |
| `errors.DB_CORRUPT` | "Your data file was damaged. I restored your most recent backup and kept the damaged copy aside." |
| `errors.DISK_FULL` | "I can't save right now, your disk may be full. Free up some space and try again." |
| `errors.AUTH_REQUIRED` | "Sign in to use Apollo’s assistant. Timers, notes, and your calendar keep working offline." |
| `errors.QUOTA_EXCEEDED` | "You've used this period's requests. Your plan resets soon, and local features keep working." |
| `confirm.ask` | _(template, 1 arg)_ |
| `confirm.askShort` | "Send it?" |
| `confirm.askBatch` | _(template, 1 arg)_ |
| `confirm.approve` | "Approve" |
| `confirm.approveAll` | "Approve all" |
| `confirm.denyAll` | "Deny all" |
| `confirm.deny` | "Deny" |
| `confirm.canceled` | "Canceled." |
| `confirm.denied` | "Okay, I won't." |
| `confirm.expired` | "That confirmation expired, so I did nothing." |
| `confirm.superseded` | "Replaced by a newer request." |
| `confirm.cancelWindow` | _(template, 1 arg)_ |
| `confirm.cancelNow` | "Cancel" |
| `confirm.emailSummary` | _(template, 2 args)_ |
| `confirm.taintWarning` | _(template, 1 arg)_ |
| `gcal.title` | "Google Calendar" |
| `gcal.connect` | "Connect Google Calendar" |
| `gcal.connecting` | "Connecting…" |
| `gcal.connectError` | "Couldn't connect. Live Google sign-in isn't set up yet on this build." |
| `gcal.chooseCalendars` | "Choose calendars to sync" |
| `gcal.direction` | "Sync direction" |
| `gcal.readOnly` | "Read-only" |
| `gcal.twoWay` | "Two-way" |
| `gcal.syncNow` | "Sync now" |
| `gcal.lastSync` | _(template, 1 arg)_ |
| `gcal.neverSynced` | "Not synced yet" |
| `gcal.syncing` | "Syncing…" |
| `gcal.syncError` | "Sync error — showing your last local copy" |
| `gcal.disconnect` | "Disconnect" |
| `gcal.disconnectPrompt` | "Keep a local copy of synced events?" |
| `gcal.keepLocal` | "Keep as local" |
| `gcal.removeAll` | "Remove them" |
| `gcal.cancel` | "Cancel" |
| `gcal.conflict.title` | "This event changed in two places" |
| `gcal.conflict.mine` | "Your version" |
| `gcal.conflict.theirs` | "Google version" |
| `gcal.conflict.keepMine` | "Keep mine" |
| `gcal.conflict.keepTheirs` | "Keep theirs" |
| `gcal.conflict.keepBoth` | "Keep both" |
| `gcal.conflict.resolved` | "Resolved." |
| `shortcuts.title` | "Keyboard shortcuts" |
| `shortcuts.scopes.Global` | "Global" |
| `shortcuts.scopes.Workspace` | "Workspace" |
| `shortcuts.scopes.Calendar` | "Calendar" |
| `shortcuts.scopes.Notes` | "Notes" |
| `shortcuts.scopes.Voice` | "Voice" |
| `orbControls.cancel` | "Cancel" |
| `orbControls.stop` | "Stop" |
| `orbControls.skip` | "Skip" |
| `orbControls.replay` | "Replay" |
| `orbControls.progress` | _(template, 2 args)_ |
| `orbControls.openChat` | "Open chat" |
| `orbControls.openApollo` | "Open Apollo" |
| `orbControls.openInChat` | "Open in chat" |
| `cards.pin` | "Pin" |
| `cards.unpin` | "Unpin" |
| `cards.open` | "Open" |
| `cards.preview` | "Preview" |
| `cards.copy` | "Copy" |
| `cards.copyIcs` | "Copy as ICS" |
| `cards.copied` | "Copied" |
| `cards.delete` | "Delete" |
| `cards.edit` | "Edit" |
| `cards.cancel` | "Cancel" |
| `cards.send` | "Send" |
| `cards.loadImages` | _(template, 1 arg)_ |
| `cards.moreEvents` | _(template, 1 arg)_ |
| `cards.to` | "To" |
| `cards.subject` | "Subject" |
| `cards.unread` | "Unread" |
| `cards.today` | "Today" |
| `cards.tomorrow` | "Tomorrow" |
| `cards.allDay` | "All day" |
| `spoken.timerSet` | _(template, 1 arg)_ |
| `spoken.timerDone` | _(template, 1 arg)_ |
| `spoken.timerCanceled` | "Timer canceled." |
| `spoken.alarmFired` | _(template, 1 arg)_ |
| `spoken.reminderFired` | _(template, 1 arg)_ |
| `spoken.timeNow` | _(template, 1 arg)_ |
| `spoken.dateToday` | _(template, 1 arg)_ |
| `spoken.appOpened` | _(template, 1 arg)_ |
| `spoken.appNotFound` | _(template, 1 arg)_ |
| `spoken.volumeSet` | _(template, 1 arg)_ |
| `spoken.muted` | "Muted. Tap the orb or press the hotkey when you need me." |
| `spoken.unmuted` | "I'm listening again." |
| `spoken.stoppedTalking` | "Okay." |
| `spoken.undone` | _(template, 1 arg)_ |
| `spoken.nothingToUndo` | "There is nothing to undo in this conversation." |
| `spoken.nothingToRepeat` | "I haven't said anything yet." |
| `spoken.newConversation` | "Starting fresh." |
| `spoken.whileAway` | _(template, 1 arg)_ |
| `spoken.briefIntro` | "Here is your brief." |
| `spoken.listItemAdded` | _(template, 1 arg)_ |
| `spoken.listEmpty` | "Your list is empty." |
| `spoken.weatherNow` | _(template, 3 args)_ |
| `spoken.weatherForecast` | _(template, 5 args)_ |
| `spoken.weatherNoHome` | "I don't have a home location yet. Set one in Settings, under Profile." |
| `onboarding.welcomeTitle` | "Meet Apollo" |
| `onboarding.welcomeBody` | "A quiet assistant that lives at the edge of your screen. Talk to it, or type." |
| `onboarding.permissionsTitle` | "Two permissions" |
| `onboarding.permissionsBody` | "Apollo needs the microphone to hear you, and accessibility to see the active window. Both stay on this Mac." |
| `onboarding.accountTitle` | "Sign in to Apollo" |
| `onboarding.accountBody` | "Signing in turns on the assistant. Notes, calendar, timers, and reminders all work without it, and stay on this device either way." |
| `onboarding.accountSignedIn` | "You're signed in." |
| `onboarding.keysTitle` | "Connect your keys" |
| `onboarding.keysBody` | "This is a developer build, so it uses your own provider keys. Anthropic and Deepgram are required; the others unlock extras and can wait." |
| `onboarding.finishTitle` | "You're set" |
| `onboarding.finishBody` | "Say \"Hey Apollo\", or type in the Chat tab: \"set a timer for 5 minutes\"." |
| `onboarding.next` | "Next" |
| `onboarding.back` | "Back" |
| `onboarding.skip` | "Skip" |
| `onboarding.done` | "Finish" |
| `onboarding.test` | "Test" |
| `onboarding.profileTitle` | "A little about you" |
| `onboarding.profileBody` | "Your name is required. Location is optional, and everything is editable later in Settings — it powers weather and the daily brief." |
| `onboarding.profileName` | "Name (required)" |
| `onboarding.profileNamePlaceholder` | "What should Apollo call you?" |
| `onboarding.profileHome` | "Location (optional)" |
| `onboarding.profileNameMissing` | "Please enter your name to continue." |
| `onboarding.wakeTitle` | "Hands-free" |
| `onboarding.wakeBody` | "Say \"Hey Apollo\" to wake it, or hold the hotkey to talk without a wake word. Tune how sensitive the wake word is." |
| `onboarding.wakeToggle` | "Enable wake word" |
| `onboarding.wakeSensitivity` | "Sensitivity" |
| `onboarding.tryTitle` | "Try it" |
| `onboarding.tryBody` | "Say \"Hey Apollo\", or type in the Chat tab. Try \"set a timer for 5 minutes\" or \"what's the weather\"." |
| `onboarding.tryFinish` | "Open chat" |
| `onboarding.stepIndicator` | _(template, 2 args)_ |
| `onboarding.sampleNote` | "Add a welcome note with example prompts" |
| `onboarding.signInBanner` | "Sign in to use Apollo’s assistant." |
| `onboarding.signInAction` | "Sign in" |
| `onboarding.byokKeysBanner` | "Add your provider keys in Settings → Keys to enable the assistant." |
| `onboarding.byokKeysAction` | "Open Keys" |
| `onboarding.dismiss` | "Dismiss" |
| `onboarding.welcomeNote` | "Things you can ask Apollo\n\n• \"Set a timer for 10 minutes\"\n• \"What's the weather this weekend?\"\n• \"Put dentist on my calendar Tuesday at 3\"\n• \"Remind me to call mom tomorrow at 6\"\n• \"Take a note: the wifi password is hunter2\"\n• \"What did I say about the drone idea?\"\n• Paste a link and ask \"what does this say?\"\n\nThis is a normal note — edit it or delete it whenever you like." |
| `settings.tabs.general` | "General" |
| `settings.tabs.account` | "Account" |
| `settings.tabs.capabilities` | "Capabilities" |
| `settings.tabs.timeFocus` | "Time and Focus" |
| `settings.tabs.customize` | "Customize" |
| `settings.tabs.privacy` | "Privacy" |
| `settings.tabs.about` | "About" |
| `settings.tabs.keys` | "Keys" |
| `settings.search.placeholder` | "Search settings" |
| `settings.search.noResults` | _(template, 1 arg)_ |
| `settings.search.resultsLabel` | "Search results" |
| `settings.timeFocus.title` | "Time and Focus" |
| `settings.timeFocus.subtitle` | "When Apollo may interrupt you, and when it should stay quiet." |
| `settings.timeFocus.quietHours` | "Quiet hours" |
| `settings.timeFocus.quietHoursBody` | "Nudges stay silent and alerts do not speak during this window. Timers and alarms still ring." |
| `settings.timeFocus.quietFrom` | "From" |
| `settings.timeFocus.quietTo` | "To" |
| `settings.timeFocus.breaks` | "Break reminders" |
| `settings.timeFocus.breaksBody` | "A quiet nudge to step away. Off by default, skipped during quiet hours, and never mid-conversation." |
| `settings.timeFocus.breakEvery` | "Remind me every" |
| `settings.timeFocus.breakOnlyActive` | "Only while I am using the computer" |
| `settings.timeFocus.breakOnlyActiveHint` | "Skips the reminder if you have been away anyway." |
| `settings.timeFocus.minutes` | _(template, 1 arg)_ |
| `settings.timeFocus.dailyBrief` | "Daily brief" |
| `settings.timeFocus.dailyBriefBody` | "The morning summary of your day." |
| `settings.timeFocus.briefTime` | "Deliver at" |
| `settings.timeFocus.followUp` | "Follow-up window" |
| `settings.timeFocus.followUpBody` | "How long Apollo keeps listening after it answers, so you can reply without the wake word." |
| `settings.capabilities.title` | "Capabilities" |
| `settings.capabilities.subtitle` | "What Apollo is allowed to do, and how it talks." |
| `settings.capabilities.voiceSection` | "Voice" |
| `settings.capabilities.proactiveSection` | "Proactive nudges" |
| `settings.capabilities.calendarSection` | "Calendars" |
| `settings.capabilities.filesSection` | "Files it may read" |
| `settings.capabilities.filesBody` | "Apollo can only search and read inside these folders." |
| `settings.customize.title` | "Customize" |
| `settings.customize.subtitle` | "Connect other services and tailor what Apollo can reach." |
| `settings.customize.skills` | "Skills" |
| `settings.customize.skillsBody` | "Standing instructions Apollo follows in every conversation — how to talk, what language, what to always do. Apollo's safety rules still apply." |
| `settings.customize.skillsEmpty` | "No skills yet. Try one like \"Keep replies under two sentences.\"" |
| `settings.customize.skillAdd` | "Add a skill" |
| `settings.customize.skillName` | "Skill name" |
| `settings.customize.skillNamePlaceholder` | "Name (e.g. Terse mode)" |
| `settings.customize.skillPrompt` | "Instructions" |
| `settings.customize.skillPromptPlaceholder` | "What should Apollo always do?" |
| `settings.customize.skillSave` | "Save" |
| `settings.customize.skillCancel` | "Cancel" |
| `settings.customize.skillDelete` | "Delete skill" |
| `settings.customize.connectors` | "Connectors" |
| `settings.customize.connectorsBody` | "Accounts Apollo can read from, with your permission." |
| `settings.customize.feeds` | "News sources" |
| `settings.customize.feedsBody` | "The feeds behind your daily brief and news card." |
| `settings.account.title` | "Your Apollo account" |
| `settings.account.signedInAs` | _(template, 1 arg)_ |
| `settings.account.plan` | _(template, 1 arg)_ |
| `settings.account.signIn` | "Sign in" |
| `settings.account.signInBody` | "Sign in to use the assistant. Your notes, calendar, and reminders stay on this device." |
| `settings.account.signingIn` | "Signing in…" |
| `settings.account.emailLabel` | "Email" |
| `settings.account.emailPlaceholder` | "you@example.com" |
| `settings.account.passwordLabel` | "Password" |
| `settings.account.passwordPlaceholder` | "Your password" |
| `settings.account.nameLabel` | "Name" |
| `settings.account.namePlaceholder` | "What should Apollo call you?" |
| `settings.account.createAccount` | "Create account" |
| `settings.account.creatingAccount` | "Creating your account…" |
| `settings.account.haveAccount` | "Already have an account? Sign in" |
| `settings.account.needAccount` | "New here? Create an account" |
| `settings.account.showPassword` | "Show password" |
| `settings.account.hidePassword` | "Hide password" |
| `settings.account.signUpBody` | "Create an account to use the assistant. Your notes, calendar, and reminders stay on this device." |
| `settings.account.passwordHint` | "At least 10 characters. A few plain words beat one clever word." |
| `settings.account.errEmailInvalid` | "Enter a valid email address." |
| `settings.account.errPasswordRequired` | "Enter your password." |
| `settings.account.errPasswordShort` | "Use at least 10 characters." |
| `settings.account.errInvalidCredentials` | "That email and password do not match." |
| `settings.account.errEmailTaken` | "That email cannot be used. Try signing in instead." |
| `settings.account.errTooManyAttempts` | "Too many attempts. Try again in 15 minutes." |
| `settings.account.errNetwork` | "Could not reach Apollo. Check your connection and try again." |
| `settings.account.errBusy` | "Already signing in." |
| `settings.account.errGeneric` | "Sign-in failed. Try again." |
| `settings.account.signOut` | "Sign out" |
| `settings.account.usage` | _(template, 2 args)_ |
| `settings.account.usageResets` | _(template, 1 arg)_ |
| `settings.account.nearLimit` | "You're close to this period's limit." |
| `settings.account.overLimit` | "You've used this period's requests. Local features keep working." |
| `settings.account.managePlan` | "Manage plan" |
| `settings.account.byokNotice` | "This is a developer build using your own provider keys. Sign-in is not used." |
| `settings.calendars.title` | "Calendars" |
| `settings.calendars.subtitle` | "Organize events into color-coded calendars." |
| `settings.calendars.addNew` | "Add calendar" |
| `settings.calendars.newNamePlaceholder` | "Calendar name" |
| `settings.calendars.makeDefault` | "Make default" |
| `settings.calendars.isDefault` | "Default" |
| `settings.calendars.rename` | "Rename" |
| `settings.calendars.delete` | "Delete" |
| `settings.calendars.googleBadge` | "Google" |
| `settings.calendars.readOnlyBadge` | "read-only" |
| `settings.calendars.deleteHasEvents` | _(template, 1 arg)_ |
| `settings.calendars.reassignConfirm` | "Move and delete" |
| `settings.calendars.cancel` | "Cancel" |
| `settings.calendars.cannotDeleteLast` | "You need at least one calendar." |
| `settings.proactive.title` | "Proactive nudges" |
| `settings.proactive.master` | "Let Apollo nudge me" |
| `settings.proactive.maxPerDay` | "Maximum nudges per day" |
| `settings.proactive.voiceOnNudges` | "Speak time-sensitive nudges" |
| `settings.proactive.leadMinutes` | "Lead time (minutes)" |
| `settings.proactive.digestTime` | "Time" |
| `settings.proactive.staleHours` | "Stale after (hours)" |
| `settings.proactive.recent` | "Recent nudges" |
| `settings.proactive.noRecent` | "No nudges yet." |
| `settings.proactive.outcomeLabels.acted` | "acted" |
| `settings.proactive.outcomeLabels.dismissed` | "dismissed" |
| `settings.proactive.outcomeLabels.snoozed` | "snoozed" |
| `settings.proactive.outcomeLabels.expired` | "expired" |
| `settings.general.launchAtLogin` | "Launch at login" |
| `settings.general.orbEdge` | "Orb edge" |
| `settings.general.homeLocation` | "Location" |
| `settings.general.openWorkspaceOnLaunch` | "Open Workspace on launch" |
| `settings.general.defaultView` | "Workspace opens to" |
| `settings.general.chatSendOnEnter` | "Enter sends chat messages" |
| `settings.general.chatShowToolActivity` | "Show tool activity in chat" |
| `settings.general.chatAutoScroll` | "Chat follows new messages" |
| `settings.general.resetOrbPosition` | "Reset orb position" |
| `settings.general.quickCaptureHotkey` | "Quick Capture hotkey" |
| `settings.general.quickCaptureType` | "Quick Capture default" |
| `settings.profile.title` | "Your profile" |
| `settings.profile.name` | "Name" |
| `settings.profile.nameRequired` | "Name (required)" |
| `settings.profile.namePlaceholder` | "What should Apollo call you?" |
| `settings.profile.location` | "Location" |
| `settings.profile.locationOptional` | "Location (optional)" |
| `settings.profile.country` | "Country" |
| `settings.profile.countryPlaceholder` | "Select a country…" |
| `settings.profile.city` | "City" |
| `settings.profile.cityPlaceholder` | "Type your city…" |
| `settings.profile.cityPickCountryFirst` | "Choose a country first" |
| `settings.profile.cityNoMatches` | "No matching cities" |
| `settings.profile.units` | "Units" |
| `settings.profile.imperial` | "Fahrenheit" |
| `settings.profile.metric` | "Celsius" |
| `settings.profile.timeFormat` | "Time format" |
| `settings.profile.h12` | "12-hour" |
| `settings.profile.h24` | "24-hour" |
| `settings.profile.weekStart` | "Week starts on" |
| `settings.profile.monday` | "Monday" |
| `settings.profile.sunday` | "Sunday" |
| `settings.profile.clearHome` | "Clear" |
| `settings.about.title` | "About Apollo" |
| `settings.about.version` | _(template, 1 arg)_ |
| `settings.about.checkUpdates` | "Check for updates" |
| `settings.about.checking` | "Checking…" |
| `settings.about.upToDate` | "You're up to date." |
| `settings.about.updateAvailable` | _(template, 1 arg)_ |
| `settings.about.updatesDisabled` | "Updates apply to installed builds only." |
| `settings.about.licenses` | "Open-source licenses" |
| `settings.about.openLogs` | "Open logs folder" |
| `settings.about.advanced` | "Advanced & diagnostics" |
| `settings.voice.wake` | "Wake word" |
| `settings.voice.sensitivity` | "Sensitivity" |
| `settings.voice.ptt` | "Push to talk" |
| `settings.voice.pttHotkey` | "Push-to-talk hotkey" |
| `settings.voice.voice` | "Voice" |
| `settings.voice.preview` | "Preview" |
| `settings.voice.dnd` | "Do not disturb" |
| `settings.voice.inputDevice` | "Microphone" |
| `settings.voice.outputDevice` | "Speaker" |
| `settings.voice.systemDefault` | "System default" |
| `settings.voice.ttsRate` | "Speech rate" |
| `settings.voice.earconVolume` | "Sound volume" |
| `settings.voice.followup` | "Follow-up window" |
| `settings.voice.off` | "Off" |
| `settings.voice.pauseWakeOnBattery` | "Pause wake word on battery" |
| `settings.accounts.gmail` | "Gmail" |
| `settings.accounts.connect` | "Connect" |
| `settings.accounts.disconnect` | "Disconnect" |
| `settings.accounts.reconnect` | "Reconnect" |
| `settings.accounts.reauthBadge` | "Reconnect needed" |
| `settings.accounts.connectedAs` | _(template, 1 arg)_ |
| `settings.keys.title` | "API keys" |
| `settings.keys.test` | "Test" |
| `settings.keys.ok` | "Key works." |
| `settings.keys.bad` | _(template, 1 arg)_ |
| `settings.keys.providers.anthropic` | "Anthropic" |
| `settings.keys.providers.deepgram` | "Deepgram" |
| `settings.keys.providers.brave` | "Brave Search" |
| `settings.keys.providers.picovoice` | "Picovoice" |
| `settings.keys.configured` | _(template, 2 args)_ |
| `settings.keys.remove` | "Remove" |
| `settings.keys.replace` | "Replace" |
| `settings.keys.pastePlaceholder` | "Paste key (write-only)" |
| `settings.privacy.history` | "Keep conversation history" |
| `settings.privacy.historyHint` | "Turning this off also deletes indexed chats from semantic search." |
| `settings.privacy.memoryFacts` | "Remembered facts" |
| `settings.privacy.egress` | "Apollo only ever talks to these hosts:" |
| `settings.privacy.approvedDirs` | "Folders Apollo may search" |
| `settings.privacy.wipe` | "Wipe all data" |
| `settings.privacy.wipeConfirmPrompt` | "Type ERASE to delete everything." |
| `settings.privacy.wipeConfirmWord` | "ERASE" |
| `settings.privacy.memoryIndex` | "Memory index" |
| `settings.privacy.memoryIndexWhat` | "Apollo can search your notes, past chats, and remembered facts by meaning. Indexing happens entirely on this device; nothing is uploaded." |
| `settings.privacy.memoryIndexCounts` | _(template, 4 args)_ |
| `settings.privacy.memoryIndexDisabled` | "Indexing is off. Rebuild to turn it back on." |
| `settings.privacy.memoryIndexPending` | _(template, 1 arg)_ |
| `settings.privacy.rebuildIndex` | "Rebuild index" |
| `settings.privacy.clearIndex` | "Clear index" |
| `settings.privacy.embedderState` | _(template, 1 arg)_ |
| `settings.privacy.data` | "Data" |
| `settings.privacy.backupNow` | "Back up now" |
| `settings.privacy.backups` | "Backups" |
| `settings.privacy.restore` | "Restore" |
| `settings.privacy.restoreConfirm` | _(template, 1 arg)_ |
| `settings.privacy.export` | "Export…" |
| `settings.privacy.exportWithChats` | "Include conversations" |
| `settings.privacy.import` | "Import…" |
| `settings.privacy.exportDone` | _(template, 1 arg)_ |
| `settings.privacy.importDone` | _(template, 1 arg)_ |
| `settings.privacy.actionLog` | "Action log" |
| `settings.privacy.actionLogEmpty` | "Nothing yet." |
| `settings.diagnostics.perf` | "Latency (ms)" |
| `settings.diagnostics.adapters` | "Adapters" |
| `settings.diagnostics.logs` | "Recent log" |
| `settings.diagnostics.copy` | "Copy diagnostics" |
| `settings.diagnostics.resources` | "Resources (RSS)" |
| `notifications.breakTitle` | "Time for a break" |
| `notifications.breakBody` | "You've been at it a while. Stretch, look away, get some water." |
| `notifications.whileAwayTitle` | "While you were away" |
| `notifications.voiceDisabled` | "Voice is disabled after repeated audio errors. Text still works." |
| `notifications.updateReady` | "An update is ready. It will apply on next launch." |
| `fastPath.unsupportedAlternative` | _(template, 1 arg)_ |
| `nudges.firstNudgeExplainer` | "I'll occasionally surface things like this. You can tune or turn these off in Settings > Proactive." |
| `nudges.dismiss` | "Dismiss" |
| `nudges.snooze5` | "Snooze 5 min" |
| `nudges.openCalendar` | "Open calendar" |
| `nudges.openToday` | "Open today" |
| `nudges.openInbox` | "Open inbox" |
| `nudges.meetingLeadTitle` | _(template, 2 args)_ |
| `nudges.meetingLeadBody` | _(template, 2 args)_ |
| `nudges.tomorrowPreviewTitle` | _(template, 1 arg)_ |
| `nudges.tomorrowPreviewBody` | "Here is how tomorrow looks." |
| `nudges.overdueTodosTitle` | _(template, 1 arg)_ |
| `nudges.overdueTodosBody` | _(template, 1 arg)_ |
| `nudges.needsReplyTitle` | _(template, 1 arg)_ |
| `nudges.needsReplyBody` | _(template, 1 arg)_ |
| `nudges.weatherHeadsUpTitle` | "Rain likely" |
| `nudges.weatherHeadsUpBody` | _(template, 1 arg)_ |
| `nudges.ruleNames.meeting_lead` | "meeting reminders" |
| `nudges.ruleNames.tomorrow_preview` | "tomorrow's preview" |
| `nudges.ruleNames.overdue_todos` | "overdue to-do nudges" |
| `nudges.ruleNames.needs_reply` | "reply reminders" |
| `nudges.ruleNames.weather_heads_up` | "weather heads-ups" |
| `nudges.ruleDescriptions.meeting_lead` | "A quiet heads-up a few minutes before a meeting starts." |
| `nudges.ruleDescriptions.tomorrow_preview` | "An evening summary when tomorrow is busy or starts early." |
| `nudges.ruleDescriptions.overdue_todos` | "A once-a-day nudge when to-dos are more than a day overdue." |
| `nudges.ruleDescriptions.needs_reply` | "A daily digest of inbound email threads waiting on your reply." |
| `nudges.ruleDescriptions.weather_heads_up` | "A morning heads-up when rain is likely before an event with a location." |
| `nudges.autoTuneQuestion` | _(template, 1 arg)_ |
| `nudges.autoTuneYes` | "Yes, stop" |
| `nudges.autoTuneKeep` | "Keep" |
| `nudges.stopped` | _(template, 1 arg)_ |
| `nudges.ruleDisabled` | _(template, 1 arg)_ |
| `nudges.ruleEnabled` | _(template, 1 arg)_ |
| `nudges.allDisabled` | "I've turned off all proactive nudges." |
| `nudges.allEnabled` | "I've turned all proactive nudges back on." |
| `nudges.status` | _(template, 2 args)_ |
| `nudges.quietExplanation` | "Apollo stays quiet during your Do Not Disturb hours and fullscreen apps, caps nudges per day, and spaces them at least 20 minutes apart." |
| `nudges.recentNudges` | "Recent nudges" |
| `quickCapture.placeholder` | "Capture a thought…" |
| `quickCapture.chipNote` | "Note" |
| `quickCapture.chipTodo` | "To-do" |
| `quickCapture.chipReminder` | _(template, 1 arg)_ |
| `quickCapture.savedNote` | "note" |
| `quickCapture.savedTodo` | "to-do" |
| `quickCapture.savedReminder` | "reminder" |
| `recall.title` | "From your notes & memory" |
| `recall.empty` | "No matches in your notes, chats, or memory." |
| `a11y.voiceState.idle` | "" |
| `a11y.voiceState.waking` | "Waking" |
| `a11y.voiceState.listening` | "Listening" |
| `a11y.voiceState.thinking` | "Thinking" |
| `a11y.voiceState.speaking` | "Speaking" |
| `a11y.voiceState.followup` | "Listening for a follow-up" |
| `a11y.voiceState.muted` | "Muted" |
| `a11y.voiceState.error` | "Voice error" |
| `a11y.nudge` | "You have a nudge" |
| `a11y.copyReply` | "Copy reply" |
| `a11y.copy` | "Copy" |
| `a11y.color` | "Color" |
| `alerts.timer` | "Timer" |
| `alerts.alarm` | "Alarm" |
| `alerts.dismiss` | "Dismiss" |
| `alerts.snoozeMin` | _(template, 1 arg)_ |
| `alerts.since` | _(template, 1 arg)_ |
| `alerts.now` | "now" |
| `alerts.dndSilent` | "Silenced (Do Not Disturb)." |
| `alerts.ariaRinging` | _(template, 1 arg)_ |
| `usage.warnCard` | "Heads up: today's usage passed your limit." |
| `usage.panelTitle` | "Usage" |
| `usage.today` | "Today" |
| `usage.month` | "This month" |
| `permissions.accessibilityHint` | "I need Accessibility permission to see the active window. Grant it in System Settings > Privacy & Security > Accessibility, then enable Apollo." |
| `permissions.micHint` | "I need microphone permission to hear you. Grant it in System Settings > Privacy & Security > Microphone." |
| `workspace.nav.chat` | "Chat" |
| `workspace.nav.today` | "Home" |
| `workspace.nav.calendar` | "Calendar" |
| `workspace.nav.notes` | "Notes" |
| `workspace.nav.settings` | "Settings" |
| `workspace.accountMenu.trigger` | "Account and settings" |
| `workspace.accountMenu.settings` | "Settings" |
| `workspace.accountMenu.settingsShortcut` | "⌘," |
| `workspace.accountMenu.help` | "Get help" |
| `workspace.accountMenu.signOut` | "Log out" |
| `workspace.accountMenu.signIn` | "Sign in" |
| `workspace.accountMenu.signedOut` | "Not signed in" |
| `workspace.accountMenu.signInPrompt` | "Sign in to use the assistant" |
| `workspace.accountMenu.localProfile` | "This device" |
| `workspace.accountMenu.byokSubtitle` | "Developer build" |
| `workspace.accountMenu.plan` | _(template, 1 arg)_ |
| `workspace.undo.undid` | _(template, 1 arg)_ |
| `workspace.undo.nothing` | "Nothing to undo" |
| `workspace.chats.filter` | "Filter conversations…" |
| `workspace.chats.empty` | "No conversations yet." |
| `workspace.chats.delete` | "Delete" |
| `workspace.chats.deleteConfirm` | "Delete this conversation and its indexed messages?" |
| `workspace.chat.modelPicker` | "Model" |
| `workspace.chat.composerPlaceholder` | "Message Apollo…" |
| `workspace.chat.send` | "Send" |
| `workspace.chat.stop` | "Stop" |
| `workspace.chat.sendHintEnter` | "Enter to send · Shift+Enter for a new line" |
| `workspace.chat.sendHintModEnter` | _(template, 1 arg)_ |
| `workspace.chat.newChat` | "New chat" |
| `workspace.chat.emptyGreeting` | _(template, 1 arg)_ |
| `workspace.chat.examples[0]` | "What's on my calendar tomorrow" |
| `workspace.chat.examples[1]` | "Set a timer for 10 minutes" |
| `workspace.chat.examples[2]` | "What's the weather" |
| `workspace.chat.examples[3]` | "Note: " |
| `workspace.chat.jumpToLatest` | "Jump to latest" |
| `workspace.chat.showEarlier` | _(template, 1 arg)_ |
| `workspace.chat.usedTools` | _(template, 1 arg)_ |
| `workspace.chat.thinking` | "Thinking…" |
| `workspace.chat.copy` | "Copy" |
| `workspace.chat.copied` | "Copied" |
| `workspace.chat.regenerate` | "Regenerate" |
| `workspace.chat.edit` | "Edit" |
| `workspace.chat.editDiscardNote` | "Editing resends from here and discards later replies." |
| `workspace.chat.editSave` | "Send" |
| `workspace.chat.editCancel` | "Cancel" |
| `workspace.chat.speakThis` | "Speak this" |
| `workspace.chat.dictate` | "Dictate into the composer" |
| `workspace.chat.dictateUnavailable` | "Add a Deepgram key to dictate" |
| `workspace.chat.dictating` | "Listening… tap to stop" |
| `workspace.chat.degradedBanner` | _(template, 1 arg)_ |
| `workspace.chat.degradedLlm` | "The assistant brain (Anthropic key)" |
| `workspace.chat.historyDisabled` | "Conversation history is off, so chats are not saved. You can still chat; turn history on in Settings → Privacy." |
| `workspace.chat.historyDisabledLink` | "Open Privacy settings" |
| `workspace.chat.rename` | "Rename" |
| `workspace.chat.renamePrompt` | "Conversation name" |
| `workspace.chat.pin` | "Pin" |
| `workspace.chat.unpin` | "Unpin" |
| `workspace.chat.rowMenu` | "Conversation actions" |
| `workspace.chat.collapseSidebar` | "Hide the conversation list" |
| `workspace.chat.expandSidebar` | "Show the conversation list" |
| `workspace.chat.groupPinned` | "Pinned" |
| `workspace.chat.groupToday` | "Today" |
| `workspace.chat.groupYesterday` | "Yesterday" |
| `workspace.chat.groupWeek` | "Previous 7 days" |
| `workspace.chat.groupOlder` | "Older" |
| `workspace.chat.messageCount` | _(template, 1 arg)_ |
| `workspace.greeting` | _(template, 2 args)_ |
| `workspace.today.todaysEvents` | "Today's schedule" |
| `workspace.today.weather` | "Weather" |
| `workspace.today.news` | "Today's news" |
| `workspace.today.refresh` | "Refresh" |
| `workspace.today.emptyEvents` | "No events today." |
| `workspace.today.emptyWeather` | "Add your location to see the weather." |
| `workspace.today.setLocation` | "Set your location" |
| `workspace.today.emptyNews` | "No headlines right now." |
| `workspace.today.newEvent` | "New event" |
| `workspace.calendar.month` | "Month" |
| `workspace.calendar.week` | "Week" |
| `workspace.calendar.agenda` | "Agenda" |
| `workspace.calendar.today` | "Today" |
| `workspace.calendar.prev` | "Previous" |
| `workspace.calendar.next` | "Next" |
| `workspace.calendar.prevYear` | "Previous year" |
| `workspace.calendar.nextYear` | "Next year" |
| `workspace.calendar.jumpTo` | "Jump to a month and year" |
| `workspace.calendar.jump` | "Go" |
| `workspace.calendar.year` | "Year" |
| `workspace.calendar.moreEvents` | _(template, 1 arg)_ |
| `workspace.calendar.newEvent` | "New event" |
| `workspace.calendar.allDay` | "All day" |
| `workspace.calendar.quickCreateTitle` | "New event" |
| `workspace.calendar.titlePlaceholder` | "Title" |
| `workspace.calendar.duration` | "Duration" |
| `workspace.calendar.dur30` | "30m" |
| `workspace.calendar.dur60` | "1h" |
| `workspace.calendar.dur120` | "2h" |
| `workspace.calendar.durAllDay` | "All day" |
| `workspace.calendar.create` | "Create" |
| `workspace.calendar.tzDiffers` | _(template, 1 arg)_ |
| `workspace.scopeDialog.title` | "This is a repeating event" |
| `workspace.scopeDialog.body` | "Apply your change to just this one, or all of them?" |
| `workspace.scopeDialog.single` | "This event" |
| `workspace.scopeDialog.all` | "All events" |
| `workspace.scopeDialog.cancel` | "Cancel" |
| `workspace.editor.title` | "Event" |
| `workspace.editor.titleField` | "Title" |
| `workspace.editor.allDay` | "All day" |
| `workspace.editor.start` | "Start" |
| `workspace.editor.end` | "End" |
| `workspace.editor.calendar` | "Calendar" |
| `workspace.editor.readOnly` | "read-only" |
| `workspace.editor.timezone` | "Time zone" |
| `workspace.editor.recurrence` | "Repeat" |
| `workspace.editor.recNone` | "None" |
| `workspace.editor.recDaily` | "Daily" |
| `workspace.editor.recWeekly` | _(template, 1 arg)_ |
| `workspace.editor.recWeekdays` | "Weekdays" |
| `workspace.editor.recMonthly` | _(template, 1 arg)_ |
| `workspace.editor.recCustom` | "Custom (RRULE)" |
| `workspace.editor.location` | "Location" |
| `workspace.editor.notes` | "Notes" |
| `workspace.editor.reminder` | "Reminder (minutes before)" |
| `workspace.editor.save` | "Save" |
| `workspace.editor.delete` | "Delete" |
| `workspace.editor.cancel` | "Cancel" |
| `workspace.editor.invalidRrule` | "That recurrence rule is not valid." |
| `workspace.editor.invalidTime` | "Please enter a valid start and end time." |
| `workspace.notes.editorPlaceholder` | "Start writing, or press / for blocks…" |
| `workspace.notes.blockMenu` | "Insert a block" |
| `workspace.notes.blockMenuEmpty` | "No matching block" |
| `workspace.notes.searchPlaceholder` | "Search notes…" |
| `workspace.notes.newNote` | "New note" |
| `workspace.notes.pinned` | "Pinned" |
| `workspace.notes.titlePlaceholder` | "Untitled" |
| `workspace.notes.titleLabel` | "Note title" |
| `workspace.notes.formatting` | "Formatting" |
| `workspace.notes.untitled` | "Untitled" |
| `workspace.notes.saving` | "Saving…" |
| `workspace.notes.saved` | "Saved" |
| `workspace.notes.words` | _(template, 1 arg)_ |
| `workspace.notes.pin` | "Pin" |
| `workspace.notes.unpin` | "Unpin" |
| `workspace.notes.delete` | "Delete" |
| `workspace.notes.deletedToast` | "Note deleted." |
| `workspace.notes.undo` | "Undo" |
| `workspace.notes.empty` | "No notes yet." |
| `workspace.notes.emptyEditor` | "Select a note or create a new one." |
| `workspace.notes.placeholder` | "Start writing…" |
| `workspace.notes.previewFailed` | "Couldn't load a preview for that link." |
| `workspace.omni.placeholder` | "Search notes, events, and memory…" |
| `workspace.omni.notes` | "Notes" |
| `workspace.omni.events` | "Events" |
| `workspace.omni.facts` | "Facts" |
| `workspace.omni.recent` | "Recent notes" |
| `workspace.omni.empty` | "No matches." |
| `workspace.omni.createNote` | _(template, 1 arg)_ |
| `workspace.stage.morningBrief` | "Morning brief" |
| `workspace.stage.weatherIn` | _(template, 1 arg)_ |
| `workspace.stage.news` | "Latest news" |
| `workspace.stage.schedule` | "Your schedule" |
| `workspace.stage.openInApollo` | "Open in Apollo" |
| `workspace.appOpened` | _(template, 1 arg)_ |
