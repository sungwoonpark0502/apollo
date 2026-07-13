import { type DataChanged } from '@apollo/shared';

/**
 * E2 change event bus: every mutating repo method publishes here; main
 * broadcasts data.changed to all open windows. Because agent tools and the
 * Workspace IPC handlers share the same wrapped repos, live sync across
 * surfaces is automatic.
 */
export type DataBus = {
  publish(change: DataChanged): void;
  subscribe(fn: (change: DataChanged) => void): () => void;
};

export function createDataBus(): DataBus {
  const subs = new Set<(change: DataChanged) => void>();
  return {
    publish(change) {
      for (const fn of subs) {
        try {
          fn(change);
        } catch {
          // a broken subscriber never blocks other surfaces
        }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

interface MutationSpec {
  op: DataChanged['op'];
  /** where the row id lives: first call argument, or the returned row's .id */
  id: 'arg0' | 'ret.id';
}

/**
 * Wraps the named mutating methods of a repo so each successful call publishes
 * {entity, op, id}. Falsy results (false / null / undefined) mean the mutation
 * did not happen and nothing is published.
 */
export function wrapMutations<T extends object>(
  repo: T,
  entity: DataChanged['entity'],
  spec: Partial<Record<keyof T, MutationSpec>>,
  bus: DataBus,
): T {
  const out: Record<string, unknown> = Object.assign(Object.create(Object.getPrototypeOf(repo) as object | null), repo);
  for (const [name, s] of Object.entries(spec) as Array<[string, MutationSpec]>) {
    const orig = (repo as Record<string, unknown>)[name];
    if (typeof orig !== 'function') continue;
    const fn = orig as (...args: unknown[]) => unknown;
    out[name] = (...args: unknown[]): unknown => {
      const result = fn.apply(repo, args);
      if (result === false || result === null || result === undefined) return result;
      const id = s.id === 'arg0' ? args[0] : (result as { id?: unknown }).id;
      if (typeof id === 'string') bus.publish({ entity, op: s.op, id });
      return result;
    };
  }
  return out as T;
}
