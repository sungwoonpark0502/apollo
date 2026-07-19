/**
 * C12.5 orb playback: strict FIFO Web Audio queue for streamed mp3 chunks;
 * tts.stop flushes instantly; reports drain to main so the FSM leaves
 * 'speaking'. Also plays earcons (C12.7).
 */
let ctx: AudioContext | null = null;
let pendingDecodes = 0;
let sawLast = false;
let generation = 0;

/**
 * I5 skip/replay need sentence identity, so the queue holds decoded buffers in
 * arrival order rather than pre-scheduled nodes only. One chunk is one sentence
 * (the C12 chunker flushes per sentence), so "skip" means "advance one item"
 * and "replay" means "schedule from item 0" — no provider round-trip either way.
 */
interface QueueItem {
  buffer: AudioBuffer;
  src: AudioBufferSourceNode | null;
}
let items: QueueItem[] = [];
/** Index of the item currently playing (or about to). */
let playIndex = 0;

function audioCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function maybeDrained(): void {
  if (sawLast && pendingDecodes === 0 && playIndex >= items.length) {
    sawLast = false;
    void window.apollo.call('tts.drained', {});
  }
}

/** Stops live nodes without disturbing playIndex or the retained buffers. */
function stopSources(): void {
  for (const it of items) {
    if (!it.src) continue;
    it.src.onended = null;
    try {
      it.src.stop();
    } catch {
      /* already stopped */
    }
    it.src = null;
  }
}

/** Schedules items[from..] back to back starting now. */
function scheduleFrom(from: number): void {
  const gen = generation;
  stopSources();
  playIndex = from;
  const ac = audioCtx();
  let at = ac.currentTime;
  for (let i = from; i < items.length; i++) {
    const it = items[i]!;
    const src = ac.createBufferSource();
    src.buffer = it.buffer;
    src.connect(ac.destination);
    src.start(at);
    at += it.buffer.duration;
    it.src = src;
    src.onended = () => {
      if (gen !== generation) return;
      it.src = null;
      // Items only ever finish in order, so the first unfinished one is next.
      if (i >= playIndex) playIndex = i + 1;
      maybeDrained();
    };
  }
}

/** Where the tail of the schedule currently ends, in context time. */
function scheduleEnd(): number {
  const ac = audioCtx();
  let at = ac.currentTime;
  for (let i = playIndex; i < items.length; i++) at += items[i]!.buffer.duration;
  return at;
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
      const it: QueueItem = { buffer, src: null };
      const startAt = Math.max(ac.currentTime, scheduleEnd());
      items.push(it);
      const i = items.length - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      src.start(startAt);
      it.src = src;
      src.onended = () => {
        if (gen !== generation) return;
        it.src = null;
        if (i >= playIndex) playIndex = i + 1;
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
  stopSources();
  items = [];
  playIndex = 0;
  pendingDecodes = 0;
  sawLast = false;
}

/**
 * I5 "Skip sentence": drop the sentence being spoken and start the next queued
 * one immediately. Purely local — the reply is already synthesized.
 */
export function skipSentence(): void {
  if (playIndex >= items.length) return;
  scheduleFrom(playIndex + 1);
  maybeDrained(); // skipping the last sentence drains the queue
}

/**
 * I5 "Replay": play the current reply again from its first sentence. Reuses the
 * retained buffers, so it costs no LLM turn and no TTS synthesis (an earlier
 * build sent a "repeat that" message instead, which did both).
 */
export function replayFromStart(): void {
  if (items.length === 0) return;
  scheduleFrom(0);
}

/** Sentence progress for the I5 "i of n" line: 1-based, clamped. */
export function playbackProgress(): { index: number; total: number } {
  return { index: Math.min(playIndex + 1, items.length), total: items.length };
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
