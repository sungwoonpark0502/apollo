import { describe, expect, it } from 'vitest';
import { createWorkerHost, type AudioProc } from './workerHost';

class FakeProc implements AudioProc {
  stdout = null;
  stderr = null;
  killed = false;
  private exitCb: ((code: number) => void) | null = null;
  private msgCb: ((raw: unknown) => void) | null = null;
  posted: unknown[] = [];
  on(ev: 'message' | 'exit', cb: (arg: never) => void): void {
    if (ev === 'exit') this.exitCb = cb as (code: number) => void;
    else this.msgCb = cb as (raw: unknown) => void;
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  kill(): void {
    this.killed = true;
  }
  crash(code = 1): void {
    this.exitCb?.(code);
  }
  emit(raw: unknown): void {
    this.msgCb?.(raw);
  }
}

interface Harness {
  host: ReturnType<typeof createWorkerHost>;
  procs: FakeProc[];
  disabled: number;
  runTimers: () => void;
}

function harness(): Harness {
  const procs: FakeProc[] = [];
  const timers: Array<() => void> = [];
  const h: Harness = {
    procs,
    disabled: 0,
    runTimers: () => {
      const due = timers.splice(0);
      for (const fn of due) fn();
    },
    host: createWorkerHost({
      modulePath: 'x',
      env: {},
      onMessage: () => {},
      onDisabled: () => { h.disabled += 1; },
      log: () => {},
      fork: () => { const p = new FakeProc(); procs.push(p); return p; },
      setTimer: (fn) => { timers.push(fn); },
    }),
  };
  return h;
}

describe('J3 audio worker lifecycle matrix', () => {
  it('lazy spawn: no process until start()', () => {
    const h = harness();
    expect(h.host.isRunning()).toBe(false);
    h.host.start();
    expect(h.host.isRunning()).toBe(true);
    expect(h.procs).toHaveLength(1);
  });

  it('crash-restart backoff: respawns after each crash, up to 3, then disables voice', () => {
    const h = harness();
    h.host.start();
    // crash 1 → schedule respawn; run timer → new proc
    h.procs[0]!.crash();
    expect(h.host.isRunning()).toBe(false);
    h.runTimers();
    expect(h.procs).toHaveLength(2);
    // crash 2, 3 → still respawns
    h.procs[1]!.crash(); h.runTimers();
    h.procs[2]!.crash(); h.runTimers();
    expect(h.procs).toHaveLength(4);
    // 4th crash exhausts the 3 backoffs → onDisabled, no more spawns
    h.procs[3]!.crash();
    expect(h.disabled).toBe(1);
    h.runTimers();
    expect(h.procs).toHaveLength(4);
  });

  it('noteHealthy resets the backoff so a later crash restarts from strike 1', () => {
    const h = harness();
    h.host.start();
    h.procs[0]!.crash(); h.runTimers();
    h.procs[1]!.crash(); h.runTimers(); // 2 failures accrued
    h.host.noteHealthy(); // a healthy interaction resets the counter
    // now three more crashes are needed before disable
    h.procs[2]!.crash(); h.runTimers();
    h.procs[3]!.crash(); h.runTimers();
    h.procs[4]!.crash(); h.runTimers();
    expect(h.disabled).toBe(0); // not yet disabled thanks to the reset
    h.procs[5]!.crash();
    expect(h.disabled).toBe(1);
  });

  it('stop() kills the process and suppresses respawn', () => {
    const h = harness();
    h.host.start();
    const p = h.procs[0]!;
    h.host.stop();
    expect(p.killed).toBe(true);
    expect(h.host.isRunning()).toBe(false);
    // an exit arriving after stop must not respawn
    p.crash();
    h.runTimers();
    expect(h.procs).toHaveLength(1);
  });
});
