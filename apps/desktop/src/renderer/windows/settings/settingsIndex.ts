import { STRINGS } from '@apollo/shared';

/**
 * A searchable index of every individual setting, not just the section names.
 * Searching "quiet" has to find Quiet hours inside Time and Focus; a search that
 * only matched tab titles would send the user to a page and leave them scanning
 * it, which is the problem they were trying to avoid.
 *
 * Kept as data rather than derived from the rendered tree so it is testable
 * without a DOM, and so a setting cannot be searchable-but-unreachable: a test
 * asserts every entry points at a tab that actually exists.
 */
export type TabId = keyof typeof STRINGS.settings.tabs;

export interface SettingEntry {
  /** Stable id, used to scroll to and highlight the row after navigating. */
  id: string;
  tab: TabId;
  label: string;
  /** Extra words a person might search for that are not in the label. */
  keywords?: string[];
}

const s = STRINGS.settings;

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  // General
  { id: 'launchAtLogin', tab: 'general', label: s.general.launchAtLogin, keywords: ['startup', 'boot', 'open on login'] },
  { id: 'orbEdge', tab: 'general', label: s.general.orbEdge, keywords: ['orb', 'position', 'side', 'screen'] },
  { id: 'openWorkspaceOnLaunch', tab: 'general', label: s.general.openWorkspaceOnLaunch, keywords: ['window', 'startup'] },
  { id: 'defaultView', tab: 'general', label: s.general.defaultView, keywords: ['home', 'start page', 'landing'] },
  { id: 'chatSendOnEnter', tab: 'general', label: s.general.chatSendOnEnter, keywords: ['enter', 'return', 'send', 'newline'] },
  { id: 'chatShowToolActivity', tab: 'general', label: s.general.chatShowToolActivity, keywords: ['tools', 'activity'] },
  { id: 'chatAutoScroll', tab: 'general', label: s.general.chatAutoScroll, keywords: ['scroll'] },
  { id: 'quickCaptureHotkey', tab: 'general', label: s.general.quickCaptureHotkey, keywords: ['shortcut', 'hotkey', 'capture'] },

  // Account
  { id: 'signIn', tab: 'account', label: s.account.signIn, keywords: ['login', 'log in', 'sign in', 'account', 'password', 'email'] },
  { id: 'signOut', tab: 'account', label: s.account.signOut, keywords: ['logout', 'log out', 'sign out'] },
  { id: 'usage', tab: 'account', label: s.account.title, keywords: ['usage', 'limit', 'quota', 'plan', 'billing'] },

  // Capabilities
  { id: 'wake', tab: 'capabilities', label: s.voice.wake, keywords: ['hey apollo', 'wake word', 'voice', 'listening'] },
  { id: 'sensitivity', tab: 'capabilities', label: s.voice.sensitivity, keywords: ['wake', 'trigger'] },
  { id: 'ptt', tab: 'capabilities', label: s.voice.pttHotkey, keywords: ['push to talk', 'hotkey', 'shortcut', 'mic'] },
  { id: 'voicePick', tab: 'capabilities', label: s.voice.voice, keywords: ['tts', 'speech', 'speak', 'accent'] },
  { id: 'ttsRate', tab: 'capabilities', label: s.voice.ttsRate, keywords: ['speed', 'speaking rate', 'fast', 'slow'] },
  { id: 'earconVolume', tab: 'capabilities', label: s.voice.earconVolume, keywords: ['sound', 'volume', 'chime', 'beep', 'audio'] },
  { id: 'proactive', tab: 'capabilities', label: s.capabilities.proactiveSection, keywords: ['nudges', 'suggestions', 'notifications'] },
  { id: 'calendars', tab: 'capabilities', label: s.capabilities.calendarSection, keywords: ['calendar', 'events', 'default calendar'] },

  // Time and Focus
  { id: 'quietHours', tab: 'timeFocus', label: s.timeFocus.quietHours, keywords: ['do not disturb', 'dnd', 'silent', 'night', 'sleep', 'focus'] },
  { id: 'breaks', tab: 'timeFocus', label: s.timeFocus.breaks, keywords: ['break', 'rest', 'stretch', 'pomodoro', 'stand up'] },
  { id: 'dailyBrief', tab: 'timeFocus', label: s.timeFocus.dailyBrief, keywords: ['morning', 'summary', 'briefing'] },
  { id: 'followUp', tab: 'timeFocus', label: s.timeFocus.followUp, keywords: ['follow up', 'keep listening', 'conversation'] },

  // Customize
  { id: 'skills', tab: 'customize', label: s.customize.skills, keywords: ['instructions', 'custom', 'personality', 'behavior', 'prompt', 'always'] },
  { id: 'connectors', tab: 'customize', label: s.customize.connectors, keywords: ['google', 'gmail', 'calendar', 'connect', 'integration'] },

  // Privacy
  { id: 'history', tab: 'privacy', label: s.privacy.history, keywords: ['conversation history', 'save chats', 'retention'] },
  { id: 'export', tab: 'privacy', label: s.privacy.export, keywords: ['backup', 'download', 'export data'] },
  { id: 'import', tab: 'privacy', label: s.privacy.import, keywords: ['restore', 'upload'] },
  { id: 'wipe', tab: 'privacy', label: s.privacy.wipe, keywords: ['delete everything', 'erase', 'reset', 'clear data'] },
  { id: 'approvedDirs', tab: 'privacy', label: s.privacy.approvedDirs, keywords: ['folders', 'files', 'directories', 'access'] },

  // About
  { id: 'about', tab: 'about', label: s.tabs.about, keywords: ['version', 'update', 'diagnostics', 'logs', 'licenses'] },
];

/**
 * Ranked matches for a query. Ranking matters more than filtering here: a
 * prefix hit on the label is almost always what the user meant, and a keyword
 * hit is a fallback, so they must not be interleaved alphabetically.
 */
export function searchSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const scored: Array<{ entry: SettingEntry; score: number }> = [];
  for (const entry of SETTINGS_INDEX) {
    const label = entry.label.toLowerCase();
    const tabName = STRINGS.settings.tabs[entry.tab].toLowerCase();
    let score = -1;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (label.includes(q)) score = 2;
    else if ((entry.keywords ?? []).some((k) => k.toLowerCase().startsWith(q))) score = 3;
    else if ((entry.keywords ?? []).some((k) => k.toLowerCase().includes(q))) score = 4;
    else if (tabName.includes(q)) score = 5;
    if (score >= 0) scored.push({ entry, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label)).map((x) => x.entry);
}
