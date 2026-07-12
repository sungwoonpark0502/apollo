import { readFileSync } from 'node:fs';
import { AUDIO } from '@apollo/shared';

/**
 * Minimal WAV reader for debug.injectAudio (A2.2a): accepts 16-bit PCM mono
 * 16kHz files and yields 512-sample frames exactly as the mic path would.
 */
export interface WavData {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
}

export function parseWav(buf: Buffer): WavData {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(offset + 8);
      if (format !== 1) throw new Error('only PCM WAV is supported');
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bits: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('malformed WAV: missing fmt or data chunk');
  if (fmt.bits !== 16) throw new Error('only 16-bit PCM is supported');
  const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (fmt.channels === 2) {
    const mono = new Int16Array(samples.length / 2);
    for (let i = 0; i < mono.length; i++) {
      mono[i] = Math.round(((samples[i * 2] as number) + (samples[i * 2 + 1] as number)) / 2);
    }
    return { sampleRate: fmt.sampleRate, channels: 1, samples: mono };
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

/** 512-sample frames, zero-padded tail. */
export function wavToFrames(path: string): Int16Array[] {
  const wav = parseWav(readFileSync(path));
  if (wav.sampleRate !== AUDIO.sampleRate) {
    throw new Error(`WAV must be ${AUDIO.sampleRate}Hz mono (got ${wav.sampleRate}Hz)`);
  }
  const frames: Int16Array[] = [];
  for (let i = 0; i < wav.samples.length; i += AUDIO.frameSamples) {
    const frame = new Int16Array(AUDIO.frameSamples);
    frame.set(wav.samples.subarray(i, i + AUDIO.frameSamples));
    frames.push(frame);
  }
  return frames;
}

/** Test helper: builds a 16k mono 16-bit WAV from samples. */
export function buildWav(samples: Int16Array, sampleRate: number = AUDIO.sampleRate): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer, samples.byteOffset, dataSize).copy(buf, 44);
  return buf;
}
