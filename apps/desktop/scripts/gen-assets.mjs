// Deterministically generates binary resources so no binary blobs live in git:
// tray template icons (16px/32px PNG). Earcons are generated in a later milestone.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const resources = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(resources, { recursive: true });

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Filled anti-aliased circle, black — a macOS "template" image (alpha only matters).
function circleIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size * 0.38;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      const i = (y * size + x) * 4;
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, buf);
}

for (const [name, size] of [
  ['trayTemplate.png', 16],
  ['trayTemplate@2x.png', 32],
]) {
  const p = join(resources, name);
  if (!existsSync(p)) writeFileSync(p, circleIcon(size));
}

// ---- earcons (C12.7): short tones ~-14 LUFS, written to resources/ and renderer public/ ----
const SR = 16000;
const AMP = 0.35;

function toneAmp(freq, ms, amp, fadeMs = 8) {
  const n = Math.round((SR * ms) / 1000);
  const fade = Math.round((SR * fadeMs) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * amp * env * 32767);
  }
  return out;
}

function tone(freq, ms, fadeMs = 8) {
  return toneAmp(freq, ms, AMP, fadeMs);
}

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Int16Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function wav(samples) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer, samples.byteOffset, dataSize).copy(buf, 44);
  return buf;
}

const earcons = {
  'wake.wav': concat([tone(660, 60), tone(880, 60)]), // two rising notes, 120ms
  'done.wav': tone(520, 100),
  'error.wav': tone(220, 150),
  // F1 nudge: single soft note, 90ms, quieter than wake (~-18 LUFS vs -14).
  'nudge.wav': toneAmp(720, 90, 0.18),
  // H6 ring: a gentle two-note loop (~1s) for timer/alarm alerts.
  'ring.wav': concat([toneAmp(660, 220, 0.3), toneAmp(880, 220, 0.3), tone(0, 60), toneAmp(660, 220, 0.3), toneAmp(880, 220, 0.3), tone(0, 60)]),
};
const publicEarcons = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src/renderer/public/earcons');
mkdirSync(publicEarcons, { recursive: true });
for (const [name, samples] of Object.entries(earcons)) {
  const data = wav(samples);
  for (const dir of [resources, publicEarcons]) {
    const p = join(dir, name);
    if (!existsSync(p)) writeFileSync(p, data);
  }
}
console.log('assets ok:', resources);
