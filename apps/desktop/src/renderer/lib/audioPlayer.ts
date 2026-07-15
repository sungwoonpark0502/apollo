/**
 * C12.5 orb playback: strict FIFO Web Audio queue for streamed mp3 chunks;
 * tts.stop flushes instantly; reports drain to main so the FSM leaves
 * 'speaking'. Also plays earcons (C12.7).
 */
let ctx: AudioContext | null = null;
let playhead = 0;
let sources: AudioBufferSourceNode[] = [];
let pendingDecodes = 0;
let sawLast = false;
let generation = 0;

function audioCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function maybeDrained(): void {
  if (sawLast && pendingDecodes === 0 && sources.length === 0) {
    sawLast = false;
    void window.apollo.call('tts.drained', {});
  }
}

export function enqueueTtsChunk(data: ArrayBuffer, last: boolean): void {
  const gen = generation;
  if (last) {
    sawLast = true;
    if (data.byteLength === 0) {
      maybeDrained();
      return;
    }
  }
  if (data.byteLength === 0) return;
  const ac = audioCtx();
  pendingDecodes += 1;
  void ac
    .decodeAudioData(data.slice(0))
    .then((buffer) => {
      if (gen !== generation) return; // stopped while decoding
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      const startAt = Math.max(ac.currentTime, playhead);
      src.start(startAt);
      playhead = startAt + buffer.duration;
      sources.push(src);
      src.onended = () => {
        sources = sources.filter((s) => s !== src);
        maybeDrained();
      };
    })
    .catch(() => undefined)
    .finally(() => {
      if (gen === generation) {
        pendingDecodes -= 1;
        maybeDrained();
      }
    });
}

/** tts.stop: flush the queue instantly (<100ms barge-in budget). */
export function stopPlayback(): void {
  generation += 1;
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  sources = [];
  pendingDecodes = 0;
  sawLast = false;
  playhead = 0;
}

const earconCache = new Map<string, AudioBuffer>();
let earconVolume = 0.7; // H7 earcon volume; 0 = implicit mute

export function setEarconVolume(v: number): void {
  earconVolume = Math.max(0, Math.min(1, v));
}

export async function playEarcon(name: 'wake' | 'done' | 'error' | 'nudge'): Promise<void> {
  if (earconVolume <= 0) return; // implicit mute at 0
  const ac = audioCtx();
  let buf = earconCache.get(name);
  if (!buf) {
    const res = await fetch(`/earcons/${name}.wav`);
    buf = await ac.decodeAudioData(await res.arrayBuffer());
    earconCache.set(name, buf);
  }
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  gain.gain.value = earconVolume;
  src.buffer = buf;
  src.connect(gain).connect(ac.destination);
  src.start();
}
