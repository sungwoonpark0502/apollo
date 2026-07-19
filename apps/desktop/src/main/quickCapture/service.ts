import { DateTime } from 'luxon';
import { type InvokeReq, type InvokeRes } from '@apollo/shared';
import { type Repos } from '../db/repos/index';
import { classifyCapture } from './classify';
import { appendChecklistItem } from '../notes/listNote';

/**
 * F4 Quick Capture save path: text → the same repos the tools use → DataBus →
 * live in Workspace and available to voice. Zero LLM, works offline.
 */
export interface QuickCaptureDeps {
  repos: Repos;
  tz: () => string;
  defaultType: () => 'note' | 'todo';
  onReminderArmed?: () => void; // re-arm the scheduler when a reminder is created
  now?: () => number;
}

export function createQuickCaptureService(deps: QuickCaptureDeps) {
  const now = deps.now ?? Date.now;

  return {
    classify(req: InvokeReq<'capture.classify'>): InvokeRes<'capture.classify'> {
      return classifyCapture(req.text, deps.defaultType(), new Date(now()), deps.tz());
    },

    submit(req: InvokeReq<'capture.submit'>): InvokeRes<'capture.submit'> {
      const text = req.text.trim();
      if (!text) throw new Error('empty capture');
      switch (req.type) {
        case 'note': {
          const n = deps.repos.notes.save({ content: text });
          return { ok: true, savedAs: 'note', id: n.id };
        }
        case 'todo': {
          // L2/L4.4: the To-dos surface is gone — a captured "to-do" becomes a
          // checklist item on the list note (created on first use).
          const r = appendChecklistItem(deps.repos.notes, text);
          return { ok: true, savedAs: 'todo', id: r.noteId };
        }
        case 'reminder': {
          const dueTs = req.reminderIso ? DateTime.fromISO(req.reminderIso).toMillis() : now() + 3_600_000;
          const r = deps.repos.reminders.create({ text, dueTs });
          deps.onReminderArmed?.();
          return { ok: true, savedAs: 'reminder', id: r.id };
        }
      }
    },
  };
}

export type QuickCaptureService = ReturnType<typeof createQuickCaptureService>;
