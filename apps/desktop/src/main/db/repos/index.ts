import { type Db } from '../connection';
import { createEventsRepo } from './events';
import { createRemindersRepo } from './reminders';
import { createTimersRepo } from './timers';
import { createAlarmsRepo } from './alarms';
import { createNotesRepo } from './notes';
import { createTodosRepo } from './todos';
import { createContactsRepo } from './contacts';
import { createConversationsRepo } from './conversations';
import { createMemoryRepo } from './memory';
import { createUndoRepo } from './undo';
import { createCapabilityMissesRepo, createFeedsRepo, createPerfRepo, createSettingsRepo } from './misc';

export function createRepos(db: Db) {
  return {
    events: createEventsRepo(db),
    reminders: createRemindersRepo(db),
    timers: createTimersRepo(db),
    alarms: createAlarmsRepo(db),
    notes: createNotesRepo(db),
    todos: createTodosRepo(db),
    contacts: createContactsRepo(db),
    conversations: createConversationsRepo(db),
    memory: createMemoryRepo(db),
    undo: createUndoRepo(db),
    capabilityMisses: createCapabilityMissesRepo(db),
    feeds: createFeedsRepo(db),
    perf: createPerfRepo(db),
    settings: createSettingsRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

export * from './events';
export * from './reminders';
export * from './timers';
export * from './alarms';
export * from './notes';
export * from './todos';
export * from './contacts';
export * from './conversations';
export * from './memory';
export * from './undo';
export * from './misc';
