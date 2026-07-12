import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import { workerToMainSchema, type MainToWorker, type WorkerToMain } from '@apollo/shared';

/**
 * C12.2 worker lifecycle: spawns the audio utilityProcess, restarts on crash
 * with 1s/5s/15s backoff; after 3 failures voice is disabled (text keeps
 * working) and onDisabled fires.
 */
export interface WorkerHostDeps {
  modulePath: string;
  env: Record<string, string>;
  onMessage: (msg: WorkerToMain) => void;
  onDisabled: () => void;
  log: (msg: string) => void;
}

const BACKOFFS = [1_000, 5_000, 15_000];

export function createWorkerHost(deps: WorkerHostDeps) {
  let proc: UtilityProcess | null = null;
  let failures = 0;
  let stopped = false;
  let pendingPort: MessagePortMain | null = null;

  function spawn(): void {
    if (stopped) return;
    proc = utilityProcess.fork(deps.modulePath, [], {
      env: { ...process.env, ...deps.env },
      serviceName: 'apollo-audio',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
      setTimeout(spawn, delay);
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
