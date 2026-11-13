// The building blocks environments are made of (environments/*.js), given to each as `kit`
// by the engine (engine.js). Continuous layers use looping noise and a few oscillators;
// events (a piano note, a raindrop, a wave) are scheduled ahead on the audio clock and clean
// themselves up when they end.
//
// Every node a kit makes is tracked by its environment instance, so switching or stopping
// disconnects all of it: nothing keeps running in the background.
//
// Each layer is   level (the user's mix slider) → evolution → stereo panner → output
// so evolution (evolution.js) never touches the user's level, and the stereo image (Width,
// Movement) is one StereoPannerNode per layer, with a slow LFO on it for layers that drift.
// Events sent to a layer with `spread` are placed across the stereo field (one small panner
// each, only when there is any width), and a pad's detuned pairs are split left and right.

const NOISE_SECONDS = 6;

/** White, pink or brown noise, made once per AudioContext and reused (never per event). */
export function noiseBuffer(ctx, type, cache) {
  const key = `${type}`;
  if (cache.has(key)) return cache.get(key);
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  } else if (type === 'pink') {
    // Paul Kellet's economical pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    // Brown (red): integrated white noise, leaky so it stays centred.
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  }
  // Fade the loop seam over 20 ms so the loop point never clicks.
  const fade = Math.floor(ctx.sampleRate * 0.02);
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade;
    data[i] = data[i] * k + data[length - fade + i] * (1 - k);
  }
  cache.set(key, buffer);
  return buffer;
}

/** A short reverb tail (decaying stereo noise), made once per AudioContext. */
export function impulseResponse(ctx, seconds = 3.4, decay = 2.8) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

/**
 * The kit an environment instance builds with. `out` is the instance's output; `sends`
 * the engine's shared reverb and delay inputs; `rng` the instance's seeded random source.
 */
export function createKit({ ctx, out, sends, buffers, rng, maxVoices = 12 }) {
  const owned = new Set(); // continuous nodes (sources, filters, gains)
  const active = new Set(); // scheduled event voices still sounding
  const layers = new Map(); // a layer's level gain → { gain, evo, panner, reverb, delay, space, drift }
  const space = { width: 0, movement: 0 };
  const stereo = typeof ctx.createStereoPanner === 'function';
  let disposed = false;

  let collecting = null; // nodes made inside collect(), so they can be freed together
  const own = (node) => {
    owned.add(node);
    collecting?.push(node);
    return node;
  };

  /** Runs `make` and returns { result, nodes }: every continuous node it made. */
  const collect = (make) => {
    const prev = collecting;
    collecting = [];
    try {
      const result = make();
      return { result, nodes: collecting };
    } finally {
      collecting = prev;
    }
  };

  /** Stops and disconnects continuous nodes made earlier (a sound no longer needed). */
  const free = (nodes) => {
    for (const node of nodes) {
      try { if (typeof node.stop === 'function') node.stop(); } catch { /* not started */ }
      try { node.disconnect(); } catch { /* already gone */ }
      owned.delete(node);
    }
  };
  const gain = (value = 1) => {
    const g = own(ctx.createGain());
    g.gain.value = value;
    return g;
  };
  const filter = (type, frequency, Q = 0.7) => {
    const f = own(ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  };
  /** A looping noise source, started now at a random point so layers never line up. */
  const loop = (type, { rate = 1 } = {}) => {
    const src = own(ctx.createBufferSource());
    src.buffer = noiseBuffer(ctx, type, buffers);
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(ctx.currentTime, rng() * NOISE_SECONDS * 0.9);
    return src;
  };
  const osc = (type, frequency, detune = 0) => {
    const o = own(ctx.createOscillator());
    o.type = type;
    o.frequency.value = frequency;
    o.detune.value = detune;
    o.start();
    return o;
  };
  /** A slow LFO moving `param` by ±depth around its current value. */
  const lfo = (param, rate, depth, type = 'sine') => {
    const o = osc(type, rate);
    const g = gain(depth);
    o.connect(g).connect(param);
    return { osc: o, depth: g };
  };
  /**
   * A layer: its level gain (the mix slider), then its evolution gain and stereo panner, into
   * the instance output and (optionally) the shared sends. Events go to `.gain`.
   */
  const layer = (level, { reverb = 0, delay = 0, tone = false } = {}) => {
    const g = gain(level);
    const evo = gain(1);
    g.connect(evo);
    // `tone`: a low-pass after the evolution gain, open by default (fog and distance close it).
    let post = evo;
    let toneFilter = null;
    if (tone) {
      toneFilter = filter('lowpass', 18000, 0.5);
      evo.connect(toneFilter);
      post = toneFilter;
    }
    let panner = null;
    if (stereo) {
      panner = own(ctx.createStereoPanner());
      post.connect(panner).connect(out);
    } else {
      post.connect(out);
    }
    const r = gain(reverb);
    evo.connect(r).connect(sends.reverb);
    const d = gain(delay);
    evo.connect(d).connect(sends.delay);
    const rec = { gain: g, evo, panner, tone: toneFilter, reverb: r, delay: d, space: null, drift: null };
    layers.set(g, rec);
    return rec;
  };

  // ---- the stereo image ----------------------------------------------------------------

  const placeLayer = (rec, tc) => {
    if (!rec.panner || !rec.space) return;
    const { pos, drift, rate } = rec.space;
    const centre = Math.max(-0.85, Math.min(0.85, pos * space.width)) + 0; // + 0: never -0
    glide(rec.panner.pan, centre, ctx, tc);
    if (rec.drift) {
      // Never past the edge: the drift is limited by how far the layer already sits.
      const depth = Math.min(0.9 - Math.abs(centre), drift * space.width * space.movement * 0.85);
      glide(rec.drift.depth.gain, Math.max(0, depth), ctx, tc);
      glide(rec.drift.osc.frequency, rate * (0.35 + space.movement * 1.65), ctx, tc);
    }
  };

  /** Where a layer sits (pos −1…1), how far it drifts and how widely its events spread (0–1). */
  const configureLayer = (levelGain, def = {}) => {
    const rec = layers.get(levelGain);
    if (!rec) return;
    rec.space = {
      pos: Number(def.pos) || 0,
      drift: Math.max(0, Number(def.drift) || 0),
      spread: Math.max(0, Number(def.spread) || 0),
      rate: 0.012 + rng() * 0.014, // slow: a minute or more from one side to the other
    };
    if (rec.panner && rec.space.drift > 0 && !rec.drift) rec.drift = lfo(rec.panner.pan, rec.space.rate, 0);
    placeLayer(rec, 0.05);
  };

  /** Width and Movement (0–1 each) for every layer, moved smoothly. */
  const setSpace = (width, movement, tc = 1.2) => {
    space.width = Math.max(0, Math.min(1, Number(width) || 0));
    space.movement = Math.max(0, Math.min(1, Number(movement) || 0));
    for (const rec of layers.values()) placeLayer(rec, tc);
  };

  /** The layer whose level gain is `levelGain` (the engine's evolution uses its `evo`). */
  const layerOf = (levelGain) => layers.get(levelGain) || null;

  /** A random place for an event sent to `dest` (0 when its layer has no spread or no width). */
  const placeFor = (dest) => {
    const s = layers.get(dest)?.space?.spread || 0;
    const amount = s * space.width;
    return stereo && amount > 0.03 ? (rng() * 2 - 1) * amount : 0;
  };

  /** Connects an event's last node to `dest`, through a panner when it has a place. */
  const route = (node, dest, pan) => {
    if (!pan) {
      node.connect(dest);
      return null;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p).connect(dest);
    return p;
  };

  // ---- scheduled events ----------------------------------------------------------------

  const canVoice = () => !disposed && active.size < maxVoices;
  const track = (nodes, stopAt) => {
    const voice = { nodes };
    active.add(voice);
    const first = nodes.find((n) => typeof n.stop === 'function');
    const end = () => {
      active.delete(voice);
      nodes.forEach((n) => {
        try { n.disconnect(); } catch { /* already gone */ }
      });
    };
    if (first) first.onended = end;
    else setTimeout(end, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 50);
    return voice;
  };

  /**
   * A soft piano-like or bell tone at `time`: a sine with a quieter overtone, a fast attack
   * and an exponential decay, through a gentle low-pass.
   */
  const tone = (time, frequency, { dest, level = 0.25, decay = 4, attack = 0.012, bright = 2400, kind = 'piano' } = {}) => {
    if (!canVoice()) return false;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.setTargetAtTime(0, time + attack, decay / 4.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(bright, time);
    lp.frequency.setTargetAtTime(bright * 0.45, time, decay / 3);
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = frequency;
    const b = ctx.createOscillator();
    b.type = kind === 'bell' ? 'sine' : 'triangle';
    b.frequency.value = frequency * (kind === 'bell' ? 2.76 : 2);
    const bg = ctx.createGain();
    bg.gain.value = kind === 'bell' ? 0.22 : 0.12;
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(lp);
    const p = route(lp, dest, placeFor(dest));
    const stopAt = time + decay * 1.2 + attack;
    a.start(time);
    b.start(time);
    a.stop(stopAt);
    b.stop(stopAt);
    track(p ? [a, b, bg, g, lp, p] : [a, b, bg, g, lp], stopAt);
    return true;
  };

  /**
   * A sustained chord of soft detuned triangles through one low-pass: a slow attack, held,
   * and a long release. `notes` are frequencies.
   */
  const pad = (time, notes, { dest, level = 0.08, attack = 5, hold = 18, release = 8, cutoff = 1100 } = {}) => {
    if (!canVoice()) return false;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.setValueAtTime(level, time + attack + hold);
    g.gain.linearRampToValueAtTime(0, time + attack + hold + release);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.4;
    const stopAt = time + attack + hold + release + 0.1;
    // Width: the detuned pairs split left and right (two panners for the whole chord).
    const amount = stereo ? (layers.get(dest)?.space?.spread || 0) * space.width : 0;
    const sides = amount > 0.03
      ? [-amount, amount].map((pan) => {
        const sp = ctx.createStereoPanner();
        sp.pan.value = pan;
        sp.connect(g);
        return sp;
      })
      : null;
    const oscs = [];
    for (const f of notes) {
      [-6, 6].forEach((cents, side) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(sides ? sides[side] : g);
        o.start(time);
        o.stop(stopAt);
        oscs.push(o);
      });
    }
    g.connect(lp).connect(dest);
    track([...oscs, ...(sides || []), g, lp], stopAt);
    return true;
  };

  /**
   * A shaped burst of noise from a shared buffer (a raindrop, a crackle, a wave): filtered,
   * with its own attack and decay. Light: one buffer source, one filter, one gain (and a
   * panner when it has a place in the stereo field).
   */
  const burst = (time, { type = 'white', dest, filterType = 'bandpass', frequency = 3000, Q = 1, level = 0.2, attack = 0.002, decay = 0.03, sweepTo = null }) => {
    if (disposed) return false;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, type, buffers);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(frequency, time);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, time + attack + decay * 0.8);
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.setTargetAtTime(0, time + attack, Math.max(0.005, decay / 4));
    src.connect(f).connect(g);
    const p = route(g, dest, placeFor(dest));
    const length = attack + decay * 1.4 + 0.02;
    src.start(time, rng() * Math.max(0, NOISE_SECONDS - length - 0.1));
    src.stop(time + length);
    track(p ? [src, f, g, p] : [src, f, g], time + length);
    return true;
  };

  /** A short bird-like chirp: a sine swept up and down, with a quick envelope. */
  const chirp = (time, frequency, { dest, level = 0.05, length = 0.09, rise = 1.25 } = {}) => {
    if (!canVoice()) return false;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(frequency, time);
    o.frequency.exponentialRampToValueAtTime(frequency * rise, time + length * 0.4);
    o.frequency.exponentialRampToValueAtTime(frequency * 0.9, time + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + 0.006);
    g.gain.setTargetAtTime(0, time + length * 0.5, length / 5);
    o.connect(g);
    const p = route(g, dest, placeFor(dest));
    o.start(time);
    o.stop(time + length * 1.6);
    track(p ? [o, g, p] : [o, g], time + length * 1.6);
    return true;
  };

  /**
   * A gliding tone (a call, a whistle, a howl, a creak): one oscillator following `points`
   * ([seconds from `time`, Hz], …), with an optional octave above it, a vibrato and a filter.
   */
  const whistle = (time, points, { dest, level = 0.04, type = 'sine', attack = 0.04, release = 0.15, vibrato = null, filter = null, harmonic = 0 } = {}) => {
    if (!canVoice() || !points?.length) return false;
    const end = time + points[points.length - 1][0];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.setValueAtTime(level, Math.max(time + attack, end - release));
    g.gain.linearRampToValueAtTime(0, end);
    let into = g;
    const nodes = [];
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.frequency || 1000;
      f.Q.value = filter.Q ?? 1;
      f.connect(g);
      into = f;
      nodes.push(f);
    }
    const voice = (mult, lvl) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(points[0][1] * mult, time);
      for (const [dt, hz] of points.slice(1)) o.frequency.exponentialRampToValueAtTime(Math.max(20, hz * mult), time + Math.max(0.005, dt));
      if (lvl === 1) o.connect(into);
      else {
        const hg = ctx.createGain();
        hg.gain.value = lvl;
        o.connect(hg).connect(into);
        nodes.push(hg);
      }
      o.start(time);
      o.stop(end + 0.02);
      nodes.unshift(o);
      return o;
    };
    const main = voice(1, 1);
    if (harmonic > 0) voice(2, harmonic);
    if (vibrato) {
      const v = ctx.createOscillator();
      v.frequency.value = vibrato.rate;
      const vg = ctx.createGain();
      vg.gain.value = vibrato.depth;
      v.connect(vg).connect(main.frequency);
      v.start(time);
      v.stop(end + 0.02);
      nodes.push(v, vg);
    }
    const p = route(g, dest, placeFor(dest));
    nodes.push(g);
    if (p) nodes.push(p);
    track(nodes, end + 0.02);
    return true;
  };

  /**
   * A pulsed tone (a croak, a rattle, a trill): one oscillator gated into `pulses` pulses at
   * `rate` per second, each with a short ramp so it never clicks.
   */
  const trill = (time, frequency, { dest, level = 0.04, type = 'sawtooth', pulses = 3, rate = 8, duty = 0.5, drop = 1, filter = null } = {}) => {
    if (!canVoice()) return false;
    const on = duty / rate;
    const end = time + (pulses - 1) / rate + on;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(frequency, time);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(frequency * drop, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    const ramp = Math.min(0.012, on * 0.3);
    for (let i = 0; i < pulses; i += 1) {
      const t0 = time + i / rate;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + ramp);
      g.gain.setValueAtTime(level, t0 + on - ramp);
      g.gain.linearRampToValueAtTime(0, t0 + on);
    }
    const nodes = [o, g];
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.frequency || frequency;
      f.Q.value = filter.Q ?? 1;
      o.connect(f).connect(g);
      nodes.push(f);
    } else {
      o.connect(g);
    }
    const p = route(g, dest, placeFor(dest));
    if (p) nodes.push(p);
    o.start(time);
    o.stop(end + 0.02);
    track(nodes, end + 0.02);
    return true;
  };

  /**
   * A plucked string: a sawtooth and a triangle through a low-pass that closes quickly, with
   * a fast attack and a long natural decay.
   */
  const pluck = (time, frequency, { dest, level = 0.08, decay = 2.2, bright = 3200 } = {}) => {
    if (!canVoice()) return false;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = frequency;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = frequency;
    b.detune.value = 4;
    const bg = ctx.createGain();
    bg.gain.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(bright, time);
    lp.frequency.setTargetAtTime(Math.max(frequency * 1.6, 280), time, decay / 7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + 0.004);
    g.gain.setTargetAtTime(0, time + 0.004, decay / 5);
    a.connect(lp);
    b.connect(bg).connect(lp);
    lp.connect(g);
    const p = route(g, dest, placeFor(dest));
    const stopAt = time + decay * 1.2;
    a.start(time);
    b.start(time);
    a.stop(stopAt);
    b.stop(stopAt);
    track(p ? [a, b, bg, lp, g, p] : [a, b, bg, lp, g], stopAt);
    return true;
  };

  /** A noise buffer of `type` ('white' | 'pink' | 'brown'), shared by the context. */
  const noise = (type) => noiseBuffer(ctx, type, buffers);

  /**
   * An event built from its own nodes (a passing train): they're stopped and disconnected at
   * `stopAt`, or when the instance is disposed.
   */
  const custom = (nodes, stopAt) => {
    if (disposed) {
      nodes.forEach((n) => {
        try { n.disconnect(); } catch { /* not connected */ }
      });
      return false;
    }
    track(nodes, stopAt);
    return true;
  };

  /** Stops and disconnects everything this instance made. */
  const dispose = () => {
    disposed = true;
    for (const voice of active) {
      voice.nodes.forEach((n) => {
        try { if (typeof n.stop === 'function') n.stop(); } catch { /* not started */ }
        try { n.disconnect(); } catch { /* already gone */ }
      });
    }
    active.clear();
    for (const node of owned) {
      try { if (typeof node.stop === 'function') node.stop(); } catch { /* not started */ }
      try { node.disconnect(); } catch { /* already gone */ }
    }
    owned.clear();
    layers.clear();
  };

  return {
    ctx, rng, gain, filter, loop, osc, lfo, layer, tone, pad, burst, chirp, canVoice, dispose,
    whistle, trill, pluck, noise, custom, route, placeFor, collect, free,
    configureLayer, setSpace, layerOf,
    /** The current Width and Movement. */
    space: () => ({ ...space }),
    /** For tests and diagnostics. */
    counts: () => ({ owned: owned.size, active: active.size }),
  };
}

/**
 * Moves an AudioParam to `value` smoothly (no clicks): an exponential approach with a time
 * constant of `tc` seconds.
 */
export function glide(param, value, ctx, tc = 0.4) {
  const now = ctx.currentTime;
  // Hold where it is now (mid-ramp included), then move on: a jump back would click.
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.setTargetAtTime(value, now, tc);
}
