import { type Db } from '../connection';
import { createDataBus, wrapMutations, type DataBus } from '../bus';
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
import { createSyncRepo } from './sync';
import { createCapabilityMissesRepo, createFeedsRepo, createPerfRepo, createSettingsRepo, createOAuthRepo } from './misc';
import { createSuggestionsRepo } from './suggestions';
import { createChunksRepo } from './chunks';
import { createActionLogRepo } from './actionLog';
import { createUsageLogRepo } from './usageLog';

/** All mutating repo methods publish onto the DataBus (E2). */
export function createRepos(db: Db, bus: DataBus = createDataBus()) {
  return {
    bus,
    events: wrapMutations(
      createEventsRepo(db),
      'event',
      {
        create: { op: 'create', id: 'ret.id' },
        update: { op: 'update', id: 'arg0' },
        softDelete: { op: 'delete', id: 'arg0' },
        restore: { op: 'update', id: 'arg0' },
        addExdate: { op: 'update', id: 'arg0' },
        removeExdate: { op: 'update', id: 'arg0' },
      },
      bus,
    ),
    reminders: wrapMutations(
      createRemindersRepo(db),
      'reminder',
      {
        create: { op: 'create', id: 'ret.id' },
        complete: { op: 'update', id: 'arg0' },
        uncomplete: { op: 'update', id: 'arg0' },
        snooze: { op: 'update', id: 'arg0' },
        markFired: { op: 'update', id: 'arg0' },
        rearm: { op: 'update', id: 'arg0' },
        softDelete: { op: 'delete', id: 'arg0' },
        restore: { op: 'update', id: 'arg0' },
      },
      bus,
    ),
    timers: wrapMutations(
      createTimersRepo(db),
      'timer',
      {
        start: { op: 'create', id: 'ret.id' },
        cancel: { op: 'delete', id: 'arg0' },
        uncancel: { op: 'create', id: 'arg0' },
        markFired: { op: 'update', id: 'arg0' },
      },
      bus,
    ),
    alarms: createAlarmsRepo(db),
    notes: wrapMutations(
      createNotesRepo(db),
      'note',
      {
        save: { op: 'create', id: 'ret.id' },
        update: { op: 'update', id: 'arg0' },
        setPinned: { op: 'update', id: 'arg0' },
        softDelete: { op: 'delete', id: 'arg0' },
        restore: { op: 'update', id: 'arg0' },
      },
      bus,
    ),
    todos: wrapMutations(
      createTodosRepo(db),
      'todo',
      {
        add: { op: 'create', id: 'ret.id' },
        complete: { op: 'update', id: 'arg0' },
        uncomplete: { op: 'update', id: 'arg0' },
        softDelete: { op: 'delete', id: 'arg0' },
        restore: { op: 'update', id: 'arg0' },
      },
      bus,
    ),
    contacts: createContactsRepo(db),
    conversations: createConversationsRepo(db),
    memory: createMemoryRepo(db),
    undo: createUndoRepo(db),
    capabilityMisses: createCapabilityMissesRepo(db),
    feeds: createFeedsRepo(db),
    perf: createPerfRepo(db),
    settings: createSettingsRepo(db),
    oauth: createOAuthRepo(db),
    suggestions: createSuggestionsRepo(db, { tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone }),
    chunks: createChunksRepo(db),
    actionLog: createActionLogRepo(db),
    usageLog: createUsageLogRepo(db),
    sync: createSyncRepo(db),
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
export * from './suggestions';
export * from './chunks';
export * from './actionLog';
export * from './usageLog';
