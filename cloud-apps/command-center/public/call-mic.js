// Mic for the phone call page (call.html): resamples to 24 kHz and posts 40 ms chunks of 16-bit PCM.
class Mic extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.step = sampleRate / options.processorOptions.rate;
    this.pos = 0;
    this.chunk = new Int16Array(960);
    this.n = 0;
  }

  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    for (; this.pos < x.length; this.pos += this.step) {
      const i = Math.floor(this.pos);
      const v = x[i] + ((i + 1 < x.length ? x[i + 1] : x[i]) - x[i]) * (this.pos - i);
      this.chunk[this.n++] = Math.max(-1, Math.min(1, v)) * 32767;
      if (this.n === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(960);
        this.n = 0;
      }
    }
    this.pos -= x.length;
    return true;
  }
}

registerProcessor('mic', Mic);
