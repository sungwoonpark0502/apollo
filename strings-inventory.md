# Strings Inventory (J6.4)

Generated from packages/shared/src/strings.ts — the single source of user-facing copy (A5).
Use this for the C10/C18 tone review (sentence case, no corporate filler, present tense).

Total user-facing strings: 477

| key | copy |
|-----|------|
| `app.name` | "Apollo" |
| `app.tray.open` | "Open Apollo" |
| `app.tray.quickCapture` | "Quick capture" |
| `app.tray.palette` | "Command palette" |
| `app.tray.settings` | "Settings…" |
| `app.tray.mute` | "Mute microphone" |
| `app.tray.unmute` | "Unmute microphone" |
| `app.tray.quit` | "Quit Apollo" |
| `app.palettePlaceholder` | "Ask Apollo…" |
| `toolActivityGeneric` | "Working…" |
| `toolActivity` | _(template fn)_ |
| `errors.KEY_MISSING` | _(template fn)_ |
| `errors.KEY_INVALID` | _(template fn)_ |
| `errors.RATE_LIMITED` | "That service is busy right now. I'll be ready to retry in a moment." |
| `errors.OFFLINE` | _(template fn)_ |
| `errors.STT_DOWN` | "My hearing is acting up. You can keep typing to me." |
| `errors.TTS_DOWN` | "I lost my voice for a moment; I'll answer as text and cards until it's back." |
| `errors.LLM_DOWN` | "My brain's connection is down. Timers, notes, and your calendar still work locally." |
| `errors.TOOL_FAIL` | _(template fn)_ |
| `errors.TIMEOUT` | "That was taking too long, so I stopped it." |
| `errors.CANCELED` | "" |
| `errors.INTERNAL` | "Something went wrong on my end. Mind trying that again?" |
| `errors.THROTTLED` | "That was too many requests at once. Give me a second." |
| `errors.REAUTH_NEEDED` | "I need you to reconnect your Google account in Settings > Accounts." |
| `errors.DB_CORRUPT` | "Your data file was damaged. I restored your most recent backup and kept the damaged copy aside." |
| `errors.DISK_FULL` | "I can't save right now, your disk may be full. Free up some space and try again." |
| `confirm.ask` | _(template fn)_ |
| `confirm.askShort` | "Send it?" |
| `confirm.askBatch` | _(template fn)_ |
| `confirm.approve` | "Approve" |
| `confirm.approveAll` | "Approve all" |
| `confirm.denyAll` | "Deny all" |
| `confirm.deny` | "Deny" |
| `confirm.canceled` | "Canceled." |
| `confirm.denied` | "Okay, I won't." |
| `confirm.expired` | "That confirmation expired, so I did nothing." |
| `confirm.superseded` | "Replaced by a newer request." |
| `confirm.cancelWindow` | _(template fn)_ |
| `confirm.cancelNow` | "Cancel" |
| `confirm.emailSummary` | _(template fn)_ |
| `confirm.taintWarning` | _(template fn)_ |
| `gcal.title` | "Google Calendar" |
| `gcal.connect` | "Connect Google Calendar" |
| `gcal.connecting` | "Connecting…" |
| `gcal.connectError` | "Couldn't connect. Live Google sign-in isn't set up yet on this build." |
| `gcal.chooseCalendars` | "Choose calendars to sync" |
| `gcal.direction` | "Sync direction" |
| `gcal.readOnly` | "Read-only" |
| `gcal.twoWay` | "Two-way" |
| `gcal.syncNow` | "Sync now" |
| `gcal.lastSync` | _(template fn)_ |
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
| `orbControls.progress` | _(template fn)_ |
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
| `cards.loadImages` | _(template fn)_ |
| `cards.moreEvents` | _(template fn)_ |
| `cards.to` | "To" |
| `cards.subject` | "Subject" |
| `cards.unread` | "Unread" |
| `cards.today` | "Today" |
| `cards.tomorrow` | "Tomorrow" |
| `cards.allDay` | "All day" |
| `spoken.timerSet` | _(template fn)_ |
| `spoken.timerDone` | _(template fn)_ |
| `spoken.timerCanceled` | "Timer canceled." |
| `spoken.alarmFired` | _(template fn)_ |
| `spoken.reminderFired` | _(template fn)_ |
| `spoken.timeNow` | _(template fn)_ |
| `spoken.dateToday` | _(template fn)_ |
| `spoken.appOpened` | _(template fn)_ |
| `spoken.appNotFound` | _(template fn)_ |
| `spoken.volumeSet` | _(template fn)_ |
| `spoken.muted` | "Muted. Tap the orb or press the hotkey when you need me." |
| `spoken.unmuted` | "I'm listening again." |
| `spoken.stoppedTalking` | "Okay." |
| `spoken.undone` | _(template fn)_ |
| `spoken.nothingToUndo` | "There is nothing to undo in this conversation." |
| `spoken.nothingToRepeat` | "I haven't said anything yet." |
| `spoken.newConversation` | "Starting fresh." |
| `spoken.whileAway` | _(template fn)_ |
| `spoken.briefIntro` | "Here is your brief." |
| `spoken.weatherNow` | _(template fn)_ |
| `spoken.weatherForecast` | _(template fn)_ |
| `spoken.weatherNoHome` | "I don't have a home location yet. Set one in Settings, under Profile." |
| `onboarding.welcomeTitle` | "Meet Apollo" |
| `onboarding.welcomeBody` | "A quiet assistant that lives at the edge of your screen. Talk to it, or type." |
| `onboarding.permissionsTitle` | "Two permissions" |
| `onboarding.permissionsBody` | "Apollo needs the microphone to hear you, and accessibility to see the active window. Both stay on this Mac." |
| `onboarding.keysTitle` | "Connect your keys" |
| `onboarding.keysBody` | "Anthropic and Deepgram keys are required. The others unlock extras and can wait." |
| `onboarding.finishTitle` | "You're set" |
| `onboarding.finishBody` | _(template fn)_ |
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
| `onboarding.tryBody` | _(template fn)_ |
| `onboarding.tryFinish` | "Open Apollo" |
| `onboarding.stepIndicator` | _(template fn)_ |
| `onboarding.sampleNote` | "Add a welcome note with example prompts" |
| `onboarding.keysSkippedBanner` | "Some features are limited until you add your Anthropic and Deepgram keys." |
| `onboarding.keysSkippedAction` | "Add keys" |
| `onboarding.dismiss` | "Dismiss" |
| `onboarding.welcomeNote` | "Things you can ask Apollo\n\n• \"Set a timer for 10 minutes\"\n• \"What's the weather this weekend?\"\n• \"Put dentist on my calendar Tuesday at 3\"\n• \"Remind me to call mom tomorrow at 6\"\n• \"Take a note: the wifi password is hunter2\"\n• \"What did I say about the drone idea?\"\n• Paste a link and ask \"what does this say?\"\n\nThis is a normal note — edit it or delete it whenever you like." |
| `settings.tabs.profile` | "Profile" |
| `settings.tabs.general` | "General" |
| `settings.tabs.calendars` | "Calendars" |
| `settings.tabs.voice` | "Voice" |
| `settings.tabs.proactive` | "Proactive" |
| `settings.tabs.accounts` | "Accounts" |
| `settings.tabs.keys` | "Keys" |
| `settings.tabs.privacy` | "Privacy" |
| `settings.tabs.diagnostics` | "Diagnostics" |
| `settings.tabs.about` | "About" |
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
| `settings.calendars.deleteHasEvents` | _(template fn)_ |
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
| `settings.general.hotkey` | "Global hotkey" |
| `settings.general.orbEdge` | "Orb edge" |
| `settings.general.homeLocation` | "Location" |
| `settings.general.openWorkspaceOnLaunch` | "Open Workspace on launch" |
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
| `settings.about.version` | _(template fn)_ |
| `settings.about.checkUpdates` | "Check for updates" |
| `settings.about.checking` | "Checking…" |
| `settings.about.upToDate` | "You're up to date." |
| `settings.about.updateAvailable` | _(template fn)_ |
| `settings.about.updatesDisabled` | "Updates apply to installed builds only." |
| `settings.about.licenses` | "Open-source licenses" |
| `settings.about.openLogs` | "Open logs folder" |
| `settings.voice.wake` | "Wake word" |
| `settings.voice.sensitivity` | "Sensitivity" |
| `settings.voice.ptt` | "Push to talk" |
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
| `settings.accounts.connectedAs` | _(template fn)_ |
| `settings.keys.title` | "API keys" |
| `settings.keys.test` | "Test" |
| `settings.keys.ok` | "Key works." |
| `settings.keys.bad` | _(template fn)_ |
| `settings.keys.providers.anthropic` | "Anthropic" |
| `settings.keys.providers.deepgram` | "Deepgram" |
| `settings.keys.providers.brave` | "Brave Search" |
| `settings.keys.providers.picovoice` | "Picovoice" |
| `settings.keys.configured` | _(template fn)_ |
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
| `settings.privacy.memoryIndexCounts` | _(template fn)_ |
| `settings.privacy.memoryIndexDisabled` | "Indexing is off. Rebuild to turn it back on." |
| `settings.privacy.memoryIndexPending` | _(template fn)_ |
| `settings.privacy.rebuildIndex` | "Rebuild index" |
| `settings.privacy.clearIndex` | "Clear index" |
| `settings.privacy.embedderState` | _(template fn)_ |
| `settings.privacy.data` | "Data" |
| `settings.privacy.backupNow` | "Back up now" |
| `settings.privacy.backups` | "Backups" |
| `settings.privacy.restore` | "Restore" |
| `settings.privacy.restoreConfirm` | _(template fn)_ |
| `settings.privacy.export` | "Export…" |
| `settings.privacy.exportWithChats` | "Include conversations" |
| `settings.privacy.import` | "Import…" |
| `settings.privacy.exportDone` | _(template fn)_ |
| `settings.privacy.importDone` | _(template fn)_ |
| `settings.privacy.actionLog` | "Action log" |
| `settings.privacy.actionLogEmpty` | "Nothing yet." |
| `settings.diagnostics.perf` | "Latency (ms)" |
| `settings.diagnostics.adapters` | "Adapters" |
| `settings.diagnostics.logs` | "Recent log" |
| `settings.diagnostics.copy` | "Copy diagnostics" |
| `settings.diagnostics.resources` | "Resources (RSS)" |
| `notifications.whileAwayTitle` | "While you were away" |
| `notifications.voiceDisabled` | "Voice is disabled after repeated audio errors. Text still works." |
| `notifications.updateReady` | "An update is ready. It will apply on next launch." |
| `fastPath.unsupportedAlternative` | _(template fn)_ |
| `nudges.firstNudgeExplainer` | "I'll occasionally surface things like this. You can tune or turn these off in Settings > Proactive." |
| `nudges.dismiss` | "Dismiss" |
| `nudges.snooze5` | "Snooze 5 min" |
| `nudges.openCalendar` | "Open calendar" |
| `nudges.openToday` | "Open today" |
| `nudges.openInbox` | "Open inbox" |
| `nudges.meetingLeadTitle` | _(template fn)_ |
| `nudges.meetingLeadBody` | _(template fn)_ |
| `nudges.tomorrowPreviewTitle` | _(template fn)_ |
| `nudges.tomorrowPreviewBody` | "Here is how tomorrow looks." |
| `nudges.overdueTodosTitle` | _(template fn)_ |
| `nudges.overdueTodosBody` | _(template fn)_ |
| `nudges.needsReplyTitle` | _(template fn)_ |
| `nudges.needsReplyBody` | _(template fn)_ |
| `nudges.weatherHeadsUpTitle` | "Rain likely" |
| `nudges.weatherHeadsUpBody` | _(template fn)_ |
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
| `nudges.autoTuneQuestion` | _(template fn)_ |
| `nudges.autoTuneYes` | "Yes, stop" |
| `nudges.autoTuneKeep` | "Keep" |
| `nudges.stopped` | _(template fn)_ |
| `nudges.ruleDisabled` | _(template fn)_ |
| `nudges.ruleEnabled` | _(template fn)_ |
| `nudges.allDisabled` | "I've turned off all proactive nudges." |
| `nudges.allEnabled` | "I've turned all proactive nudges back on." |
| `nudges.status` | _(template fn)_ |
| `nudges.quietExplanation` | "Apollo stays quiet during your Do Not Disturb hours and fullscreen apps, caps nudges per day, and spaces them at least 20 minutes apart." |
| `nudges.recentNudges` | "Recent nudges" |
| `quickCapture.placeholder` | "Capture a thought…" |
| `quickCapture.chipNote` | "Note" |
| `quickCapture.chipTodo` | "To-do" |
| `quickCapture.chipReminder` | _(template fn)_ |
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
| `alerts.snoozeMin` | _(template fn)_ |
| `alerts.since` | _(template fn)_ |
| `alerts.now` | "now" |
| `alerts.dndSilent` | "Silenced (Do Not Disturb)." |
| `alerts.ariaRinging` | _(template fn)_ |
| `usage.warnCard` | "Heads up: today's usage passed your limit." |
| `usage.panelTitle` | "Usage" |
| `usage.today` | "Today" |
| `usage.month` | "This month" |
| `permissions.accessibilityHint` | "I need Accessibility permission to see the active window. Grant it in System Settings > Privacy & Security > Accessibility, then enable Apollo." |
| `permissions.micHint` | "I need microphone permission to hear you. Grant it in System Settings > Privacy & Security > Microphone." |
| `workspace.nav.today` | "Today" |
| `workspace.nav.calendar` | "Calendar" |
| `workspace.nav.notes` | "Notes" |
| `workspace.nav.chats` | "Chats" |
| `workspace.nav.settings` | "Settings" |
| `workspace.undo.undid` | _(template fn)_ |
| `workspace.undo.nothing` | "Nothing to undo" |
| `workspace.chats.filter` | "Filter conversations…" |
| `workspace.chats.empty` | "No conversations yet." |
| `workspace.chats.selectHint` | "Select a conversation to read it." |
| `workspace.chats.continue` | "Continue" |
| `workspace.chats.delete` | "Delete" |
| `workspace.chats.deleteConfirm` | "Delete this conversation and its indexed messages?" |
| `workspace.greeting` | _(template fn)_ |
| `workspace.today.upNext` | "Up next" |
| `workspace.today.todaysEvents` | "Today's schedule" |
| `workspace.today.reminders` | "Reminders" |
| `workspace.today.todos` | "To-dos" |
| `workspace.today.weather` | "Weather" |
| `workspace.today.latestBrief` | "Latest brief" |
| `workspace.today.regenerate` | "Regenerate" |
| `workspace.today.addTodo` | "Add a to-do…" |
| `workspace.today.snooze` | "Snooze" |
| `workspace.today.complete` | "Done" |
| `workspace.today.emptyUpNext` | "Nothing coming up." |
| `workspace.today.emptyEvents` | "No events today." |
| `workspace.today.emptyReminders` | "No reminders due." |
| `workspace.today.emptyTodos` | "All clear." |
| `workspace.today.emptyWeather` | "Set your home location in Settings > Profile to see weather." |
| `workspace.today.emptyBrief` | "No brief yet. Say \"good morning\" or press Regenerate." |
| `workspace.today.newEvent` | "New event" |
| `workspace.today.relMin` | _(template fn)_ |
| `workspace.today.relHour` | _(template fn)_ |
| `workspace.today.relNow` | "now" |
| `workspace.today.overdue` | "overdue" |
| `workspace.calendar.month` | "Month" |
| `workspace.calendar.week` | "Week" |
| `workspace.calendar.agenda` | "Agenda" |
| `workspace.calendar.today` | "Today" |
| `workspace.calendar.prev` | "Previous" |
| `workspace.calendar.next` | "Next" |
| `workspace.calendar.moreEvents` | _(template fn)_ |
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
| `workspace.calendar.tzDiffers` | _(template fn)_ |
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
| `workspace.editor.recWeekly` | _(template fn)_ |
| `workspace.editor.recWeekdays` | "Weekdays" |
| `workspace.editor.recMonthly` | _(template fn)_ |
| `workspace.editor.recCustom` | "Custom (RRULE)" |
| `workspace.editor.location` | "Location" |
| `workspace.editor.notes` | "Notes" |
| `workspace.editor.reminder` | "Reminder (minutes before)" |
| `workspace.editor.save` | "Save" |
| `workspace.editor.delete` | "Delete" |
| `workspace.editor.cancel` | "Cancel" |
| `workspace.editor.invalidRrule` | "That recurrence rule is not valid." |
| `workspace.editor.invalidTime` | "Please enter a valid start and end time." |
| `workspace.notes.searchPlaceholder` | "Search notes…" |
| `workspace.notes.newNote` | "New note" |
| `workspace.notes.pinned` | "Pinned" |
| `workspace.notes.untitled` | "Untitled" |
| `workspace.notes.saving` | "Saving…" |
| `workspace.notes.saved` | "Saved" |
| `workspace.notes.words` | _(template fn)_ |
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
| `workspace.omni.createNote` | _(template fn)_ |
| `workspace.stage.morningBrief` | "Morning brief" |
| `workspace.stage.weatherIn` | _(template fn)_ |
| `workspace.stage.news` | "Latest news" |
| `workspace.stage.schedule` | "Your schedule" |
| `workspace.stage.openInApollo` | "Open in Apollo" |
| `workspace.appOpened` | _(template fn)_ |
