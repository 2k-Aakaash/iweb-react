// A small stand-in for the Web Audio API (tests run in Node): enough of each node for the
// engine, recording what was created, connected, started and stopped.

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, tc) { this.events.push(['target', v, t, tc]); this.target = v; return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
  cancelAndHoldAtTime(t) { this.events.push(['hold', t]); return this; }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = new Set();
    this.disconnected = false;
    ctx.nodes.push(this);
  }
  connect(target) {
    this.outputs.add(target);
    return target;
  }
  disconnect(target) {
    if (target) this.outputs.delete(target);
    else {
      this.outputs.clear();
      this.disconnected = true;
    }
  }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.started = false;
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0) {
    if (this.started) throw new Error('InvalidStateError: started twice');
    this.started = when;
  }
  stop(when) {
    if (!this.started && this.started !== 0) throw new Error('InvalidStateError: not started');
    this.stopped = true;
    this.stopAt = when ?? this.ctx.currentTime;
  }
}

export class FakeAudioContext {
  static instances = 0;

  constructor({ sampleRate = 4000, failResume = false } = {}) {
    FakeAudioContext.instances += 1;
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'suspended';
    this.nodes = [];
    this.buffersMade = 0;
    this.failResume = failResume;
    this.destination = new FakeNode(this, 'destination');
    this.onstatechange = null;
  }

  /** Moves the audio clock on, ending sources whose stop time has passed (as a browser does). */
  advance(seconds) {
    this.currentTime += seconds;
    for (const n of this.nodes) {
      if (n.stopAt !== undefined && !n.ended && n.stopAt <= this.currentTime) {
        n.ended = true;
        n.onended?.();
      }
    }
  }

  setState(state) {
    this.state = state;
    this.onstatechange?.();
  }
  resume() {
    if (this.failResume) return Promise.reject(new Error('NotAllowedError'));
    this.setState('running');
    return Promise.resolve();
  }
  suspend() { this.setState('suspended'); return Promise.resolve(); }
  close() { this.setState('closed'); return Promise.resolve(); }

  createGain() {
    const n = new FakeNode(this, 'gain');
    n.gain = new FakeParam(1);
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'filter');
    n.type = 'lowpass';
    n.frequency = new FakeParam(350);
    n.Q = new FakeParam(1);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this, 'oscillator');
    n.type = 'sine';
    n.frequency = new FakeParam(440);
    n.detune = new FakeParam(0);
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this, 'bufferSource');
    n.buffer = null;
    n.loop = false;
    n.playbackRate = new FakeParam(1);
    return n;
  }
  createBuffer(channels, length) {
    this.buffersMade += 1;
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, getChannelData: (c) => data[c] };
  }
  createConvolver() { const n = new FakeNode(this, 'convolver'); n.buffer = null; return n; }
  createDelay() { const n = new FakeNode(this, 'delay'); n.delayTime = new FakeParam(0); return n; }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0);
    return n;
  }
  createAnalyser() {
    const n = new FakeNode(this, 'analyser');
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    Object.defineProperty(n, 'frequencyBinCount', { get: () => n.fftSize / 2 });
    n.getByteTimeDomainData = (arr) => arr.fill(160);
    // A falling spectrum: more low end than high, as ambience has.
    n.getByteFrequencyData = (arr) => arr.forEach((_, i) => { arr[i] = Math.max(0, 200 - i); });
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode(this, 'panner');
    n.pan = new FakeParam(0);
    return n;
  }

  /** Live (not disconnected) nodes of a kind. */
  live(kind) {
    return this.nodes.filter((n) => !n.disconnected && (!kind || n.kind === kind)).length;
  }
}

/** A stored-pref stand-in: { get, set, subscribe }. */
export function memoryPref(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (v) => {
      value = typeof v === 'function' ? v(value) : v;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
