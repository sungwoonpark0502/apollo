import { utilityProcess, type MessagePortMain } from 'electron';
import { workerToMainSchema, type MainToWorker, type WorkerToMain } from '@apollo/shared';

/**
 * C12.2 worker lifecycle: spawns the audio utilityProcess, restarts on crash
 * with 1s/5s/15s backoff; after 3 failures voice is disabled (text keeps
 * working) and onDisabled fires.
 */
/** The subset of Electron's UtilityProcess the host uses; a fake implements it in tests. */
export interface AudioProc {
  stdout?: { on(ev: 'data', cb: (d: Buffer) => void): void } | null;
  stderr?: { on(ev: 'data', cb: (d: Buffer) => void): void } | null;
  on(ev: 'message', cb: (raw: unknown) => void): void;
  on(ev: 'exit', cb: (code: number) => void): void;
  postMessage(msg: unknown, transfer?: MessagePortMain[]): void;
  kill(): void;
}

export interface WorkerHostDeps {
  modulePath: string;
  env: Record<string, string>;
  onMessage: (msg: WorkerToMain) => void;
  onDisabled: () => void;
  log: (msg: string) => void;
  /** Injectable for tests. Defaults to Electron utilityProcess.fork. */
  fork?: (modulePath: string, env: Record<string, string>) => AudioProc;
  setTimer?: (fn: () => void, ms: number) => void;
}

const BACKOFFS = [1_000, 5_000, 15_000];

export function createWorkerHost(deps: WorkerHostDeps) {
  const fork =
    deps.fork ??
    ((modulePath: string, env: Record<string, string>) =>
      utilityProcess.fork(modulePath, [], { env: { ...process.env, ...env }, serviceName: 'apollo-audio', stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as AudioProc);
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  let proc: AudioProc | null = null;
  let failures = 0;
  let stopped = false;
  let pendingPort: MessagePortMain | null = null;

  function spawn(): void {
    if (stopped) return;
    proc = fork(deps.modulePath, deps.env);
    proc.stdout?.on('data', (d: Buffer) => deps.log(`audio worker out: ${d.toString().trim()}`));
    proc.stderr?.on('data', (d: Buffer) => deps.log(`audio worker err: ${d.toString().trim()}`));
    proc.on('message', (raw: unknown) => {
      const parsed = workerToMainSchema.safeParse(raw);
      if (parsed.success) deps.onMessage(parsed.data);
    });
    proc.on('exit', (code) => {
      deps.log(`audio worker exited code=${code}`);
      proc = null;
      if (stopped) return;
      if (failures >= BACKOFFS.length) {
        deps.onDisabled();
        return;
      }
      const delay = BACKOFFS[failures] as number;
      failures += 1;
      setTimer(spawn, delay);
    });
    if (pendingPort) {
      proc.postMessage({ t: 'port' }, [pendingPort]);
      pendingPort = null;
    }
  }

  return {
    start(): void {
      stopped = false;
      failures = 0;
      spawn();
    },
    stop(): void {
      stopped = true;
      proc?.kill();
      proc = null;
    },
    send(msg: MainToWorker): void {
      proc?.postMessage(msg);
    },
    /** Forwards the capture renderer's frame port into the worker. */
    attachAudioPort(port: MessagePortMain): void {
      if (proc) proc.postMessage({ t: 'port' }, [port]);
      else pendingPort = port;
    },
    isRunning(): boolean {
      return proc !== null;
    },
    /** Called when a healthy interaction completes so backoff resets. */
    noteHealthy(): void {
      failures = 0;
    },
  };
}

export type WorkerHost = ReturnType<typeof createWorkerHost>;
