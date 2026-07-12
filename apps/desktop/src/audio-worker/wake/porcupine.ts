import { existsSync } from 'node:fs';
import { type WakeAdapter } from './adapter';

export interface PorcupineConfig {
  accessKey: string;
  /** Custom "Hey Apollo" model; falls back to the built-in "jarvis" dev keyword (C12.4). */
  keywordPath?: string | undefined;
  sensitivity: number;
}

const GATED_DELTA = 0.15; // gated mode raises the wake threshold (C12.2)

function clamp(v: number): number {
  return Math.max(0.05, Math.min(1, v));
}

/**
 * Porcupine wake adapter. Porcupine bakes sensitivity into the engine, so the
 * gated (+0.15 threshold) variant is a second engine at lowered sensitivity.
 */
export async function createPorcupineWake(cfg: PorcupineConfig): Promise<WakeAdapter> {
  const pkg = await import('@picovoice/porcupine-node');
  const { Porcupine, BuiltinKeyword } = pkg;
  const useCustom = cfg.keywordPath !== undefined && existsSync(cfg.keywordPath);

  let sensitivity = clamp(cfg.sensitivity);
  let onWake: (() => void) | null = null;

  function build(s: number): InstanceType<typeof Porcupine> {
    return useCustom
      ? new Porcupine(cfg.accessKey, [cfg.keywordPath as string], [clamp(s)])
      : new Porcupine(cfg.accessKey, [BuiltinKeyword.JARVIS], [clamp(s)]);
  }

  let normal = build(sensitivity);
  let gated = build(sensitivity - GATED_DELTA);

  return {
    start(cb) {
      onWake = cb;
    },
    stop() {
      onWake = null;
      normal.release();
      gated.release();
    },
    setSensitivity(v) {
      sensitivity = clamp(v);
      normal.release();
      gated.release();
      normal = build(sensitivity);
      gated = build(sensitivity - GATED_DELTA);
    },
    process(pcm, isGated) {
      const engine = isGated ? gated : normal;
      try {
        if (engine.process(pcm) >= 0) onWake?.();
      } catch {
        /* frame length mismatch etc.: drop frame rather than crash the worker */
      }
    },
  };
}
