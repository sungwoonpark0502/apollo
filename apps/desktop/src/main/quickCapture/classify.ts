import * as chrono from 'chrono-node';
import { resolveTime } from '../agent/timeResolver';

export type CaptureType = 'note' | 'todo' | 'reminder';

export interface CaptureClassification {
  suggestedType: CaptureType;
  reminderAvailable: boolean;
  reminderIso: string | null;
  timePhrase: string | null; // substring to underline / strip for the reminder text
  /** The text to persist for each possible type (todo strips prefix/suffix; reminder strips the time phrase). */
  texts: { note: string; todo: string; reminder: string };
}

const TODO_PREFIX = /^todo\s+/i;
const TODO_SUFFIX = /\s*!+\s*$/;

/**
 * F4 Quick Capture classifier (pure): leading "todo " / trailing "!" force Todo
 * (stripped on save); otherwise a future datetime makes it a Reminder with the
 * time phrase stripped from the saved text; else the default type.
 */
export function classifyCapture(text: string, defaultType: 'note' | 'todo', now: Date, tz: string): CaptureClassification {
  const trimmed = text.trim();
  const noteText = text;

  // Todo forcing (prefix/suffix)
  if (TODO_PREFIX.test(trimmed)) {
    const todo = trimmed.replace(TODO_PREFIX, '').trim();
    return { suggestedType: 'todo', reminderAvailable: false, reminderIso: null, timePhrase: null, texts: { note: noteText, todo, reminder: todo } };
  }
  if (TODO_SUFFIX.test(trimmed)) {
    const todo = trimmed.replace(TODO_SUFFIX, '').trim();
    return { suggestedType: 'todo', reminderAvailable: false, reminderIso: null, timePhrase: null, texts: { note: noteText, todo, reminder: todo } };
  }

  // Time resolution (Apollo grammar for the iso; chrono for the matched phrase)
  const resolved = trimmed ? resolveTime(trimmed, { now, tz }) : null;
  if (resolved && new Date(resolved.iso).getTime() > now.getTime()) {
    const phrase = findTimePhrase(trimmed, now, tz);
    const reminderText = phrase ? trimmed.replace(phrase, '').replace(/\s{2,}/g, ' ').trim() : trimmed;
    return {
      suggestedType: 'reminder',
      reminderAvailable: true,
      reminderIso: resolved.iso,
      timePhrase: phrase,
      texts: { note: noteText, todo: trimmed, reminder: reminderText || trimmed },
    };
  }

  return { suggestedType: defaultType, reminderAvailable: false, reminderIso: null, timePhrase: null, texts: { note: noteText, todo: trimmed, reminder: trimmed } };
}

/** The chrono-matched date phrase in the text (for underlining + stripping), or null. */
function findTimePhrase(text: string, now: Date, tz: string): string | null {
  try {
    const results = chrono.parse(text, { instant: now, timezone: tz }, { forwardDate: true });
    return results[0]?.text ?? null;
  } catch {
    return null;
  }
}

/** F4 Tab cycle: Note → Todo → Reminder (Reminder only when a time was resolved) → Note. */
export function nextCaptureType(current: CaptureType, reminderAvailable: boolean): CaptureType {
  const cycle: CaptureType[] = reminderAvailable ? ['note', 'todo', 'reminder'] : ['note', 'todo'];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? 'note';
}
