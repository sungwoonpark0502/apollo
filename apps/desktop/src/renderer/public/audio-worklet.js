// AudioWorklet: buffers input into Int16 512-sample frames (C12.1).
class FramerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(512);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.fill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.fill === 512) {
        const out = this.buf.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor('apollo-framer', FramerProcessor);
