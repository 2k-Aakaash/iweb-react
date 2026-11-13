// The Frontier sound library: one builder per kind of layer (catalogue.js), each in a few
// flavours. Everything is synthesized from noise and oscillators with the shared voice kit
// (voices.js): no recordings, nothing downloaded.
//
// A builder makes one engine layer (kit.layer: the user's level, evolution, stereo) and
// returns
//   { layer, gain, category, rev,
//     setConditions(mult, cond, tc)   time and weather: a level for continuous sound, a rate
//                                     for events (conditions.js)
//     apply(params), schedule(from, to), randomize(rng), evolve(rng) }
// Continuous sound runs on looping noise and oscillators (no scheduling at all); events are
// scheduled a little ahead on the audio clock, at a rate that follows the conditions and
// Mood, so night is sparse for birds and busy for frogs.
import { glide } from '../voices.js';
import { range, weighted } from '../random.js';
import { CATEGORY, weatherMix } from './conditions.js';

/**
 * Scale (the layer's loudness at full level), sends and stereo place, per kind. `fog`: how far
 * fog closes a distant kind's low-pass (Hz); without it the kind isn't muffled.
 */
export const KINDS = Object.freeze({
  air: { scale: 0.5, reverb: 0.3, space: { pos: 0, drift: 0.2 } },
  wind: { scale: 0.75, reverb: 0.2, space: { pos: 0, drift: 0.75 } },
  foliage: { scale: 0.5, reverb: 0.15, space: { pos: 0.2, drift: 0.45 } },
  water: { scale: 0.65, reverb: 0.2, space: { pos: -0.35, drift: 0.12, spread: 0.5 } },
  insects: { scale: 0.4, reverb: 0.25, space: { pos: 0.1, drift: 0.3, spread: 0.6 } },
  frogs: { scale: 0.8, reverb: 0.35, space: { pos: -0.1, spread: 0.85 }, fog: 5000 },
  birds: { scale: 0.85, reverb: 0.4, delay: 0.08, space: { pos: 0.05, spread: 0.9 }, fog: 4200 },
  wildlife: { scale: 1, reverb: 0.6, delay: 0.14, space: { pos: 0, spread: 0.9 }, fog: 2200 },
  distant: { scale: 0.8, reverb: 0.45, delay: 0.06, space: { pos: 0.25, drift: 0.1, spread: 0.5 }, fog: 2600 },
  fire: { scale: 0.8, reverb: 0.12, space: { pos: 0, drift: 0.1, spread: 0.4 } },
  weather: { scale: 0.85, reverb: 0.3, space: { pos: 0, drift: 0.25, spread: 0.85 } },
});

const poisson = (rng, perSecond) => -Math.log(1 - rng()) / Math.max(1e-6, perSecond);

/**
 * An event stream at a varying rate (per second): `emit(time)` for each event in [from, to).
 * A rate near zero stops it; it restarts from the window's start, never with a backlog.
 */
function stream(rng, emit, max = 40) {
  let next = 0;
  return (from, to, rate) => {
    if (!(rate > 0.0005)) {
      next = 0;
      return;
    }
    if (next < from) next = from + poisson(rng, rate) * rng();
    let n = 0;
    while (next < to && n < max) {
      emit(next);
      n += 1;
      next += poisson(rng, rate);
    }
  };
}

/** The open low-pass and how fast fog settles in or lifts. */
const OPEN = 18000;

/**
 * The common part of every builder: the layer, its condition gain, and the defaults. `shared`
 * is the place's own: its gust rate, the event budget and the tuning ({ eventIntensity,
 * weatherIntensity, lite }), read when scheduling so a change applies at once.
 */
function base(kit, kind, extra = {}, shared = SHARED_DEFAULT) {
  const k = KINDS[kind];
  const layer = kit.layer(0, { reverb: extra.reverb ?? k.reverb, delay: extra.delay ?? k.delay ?? 0, tone: Boolean(k.fog) });
  const cond = kit.gain(1);
  cond.connect(layer.gain);
  const st = { mult: 1, cond: { time: 'afternoon', weather: 'clear', progress: 0.5 }, params: { mood: 0.35, variation: 0.45, depth: 0.55 }, shared };
  // Fog: distant kinds lose their highs, as sound does in thick air.
  const fog = (c, tc) => {
    if (layer.tone) glide(layer.tone.frequency, c.weather === 'fog' ? k.fog : OPEN, kit.ctx, Math.max(tc, 2));
  };
  return {
    layer,
    cond,
    st,
    api: {
      layer,
      gain: layer.gain,
      category: CATEGORY[kind],
      rev: extra.reverb ?? k.reverb,
      setConditions(mult, c, tc) {
        st.mult = mult;
        st.cond = c;
        glide(cond.gain, mult, kit.ctx, tc);
        fog(c, tc);
      },
      apply(p) { st.params = p; },
      schedule() {},
      randomize() {},
      evolve() {},
    },
  };
}

/**
 * A continuous sound that only exists while it's wanted: built when its level rises above
 * zero, faded out and freed (its nodes stopped and released) once it's silent. Rain on a
 * clear day, crickets at noon and cicadas at midnight cost nothing.
 */
function lazy(kit, into, build) {
  let bed = null;
  let releaseAt = 0;
  return {
    set(target, tc) {
      if (target > 0.001) {
        if (!bed) {
          const { result, nodes } = kit.collect(() => {
            const out = kit.gain(0);
            build(out);
            out.connect(into);
            return out;
          });
          bed = { out: result, nodes };
        }
        releaseAt = 0;
        glide(bed.out.gain, target, kit.ctx, tc);
      } else if (bed) {
        glide(bed.out.gain, 0, kit.ctx, tc);
        releaseAt = kit.ctx.currentTime + tc * 5 + 0.5;
      }
    },
    /** Frees it once its fade-out is over (called from the layer's schedule). */
    tick(now) {
      if (bed && releaseAt && now >= releaseAt) {
        kit.free(bed.nodes);
        bed = null;
        releaseAt = 0;
      }
    },
    active: () => Boolean(bed),
  };
}

const SHARED_DEFAULT = Object.freeze({ gustRate: 0.045, budget: null, tune: { eventIntensity: 0.5, weatherIntensity: 0.5, lite: false } });

/** How busy events are: the conditions' multiplier and Mood (calm to lively); fewer in lite. */
const busy = (st) => st.mult * (0.6 + st.params.mood * 0.8) * (st.shared.tune.lite ? 0.6 : 1);

/** Event Intensity as a rate multiplier: 0 → 0.3, 0.5 → 1 (as designed), 1 → 1.7. */
export const eventFactor = (v) => 0.3 + 1.4 * v;
/** Weather Intensity as a level multiplier: 0 → 0.4, 0.5 → 1, 1 → 1.6. */
export const weatherFactor = (v) => 0.4 + 1.2 * v;

/** A notable sound may start now if the place's event budget allows it (always, without one). */
const allowed = (st, t) => !st.shared.budget || st.shared.budget.take(t);

// ── Air: the base of the place, a low wide hush ────────────────────────────────────────

const AIR = {
  open: { lp: 240, reverb: 0.3 },
  forest: { lp: 170, reverb: 0.22 },
  canyon: { lp: 300, reverb: 0.6, delay: 0.12 },
  wetland: { lp: 210, reverb: 0.3 },
  mountain: { lp: 320, reverb: 0.35, hiss: 0.05 },
};

function air(kit, variant, shared) {
  const v = AIR[variant] || AIR.open;
  const { cond, api } = base(kit, 'air', v, shared);
  const lp = kit.filter('lowpass', v.lp, 0.5);
  const body = kit.gain(0.9);
  kit.loop('brown', { rate: 0.8 }).connect(lp).connect(body).connect(cond);
  kit.lfo(body.gain, 0.031, 0.14);
  if (v.hiss) {
    const hp = kit.filter('highpass', 3800, 0.5);
    const hg = kit.gain(v.hiss);
    kit.loop('pink').connect(hp).connect(hg).connect(cond);
  }
  api.apply = (p) => glide(lp.frequency, v.lp * (0.75 + p.depth * 0.6), kit.ctx, 2);
  return api;
}

// ── Wind: a broad band of noise that gusts, with a whistle where it's exposed ─────────

const WIND = {
  prairie: { noise: 'pink', f: 480, Q: 0.6, body: 0.7, sweep: 160 },
  pines: { noise: 'pink', f: 850, Q: 0.5, body: 0.6, sweep: 260, high: 0.18 },
  alpine: { noise: 'brown', f: 380, Q: 0.7, body: 0.95, sweep: 120, whistles: [[820, 9, 0.12]] },
  ridge: { noise: 'brown', f: 420, Q: 0.6, body: 0.9, sweep: 140, whistles: [[720, 11, 0.1], [1180, 12, 0.07]] },
  desert: { noise: 'pink', f: 620, Q: 0.55, body: 0.65, sweep: 200, grit: 0.1 },
  marsh: { noise: 'pink', f: 380, Q: 0.6, body: 0.55, sweep: 120 },
};

function wind(kit, variant, shared) {
  const v = WIND[variant] || WIND.prairie;
  const { cond, st, api } = base(kit, 'wind', {}, shared);
  const { ctx, rng } = kit;
  const band = kit.filter('bandpass', v.f, v.Q);
  const body = kit.gain(v.body);
  const gust = kit.gain(0.75);
  kit.loop(v.noise).connect(band).connect(body).connect(gust).connect(cond);
  const swell = kit.lfo(gust.gain, shared.gustRate, 0.22);
  kit.lfo(gust.gain, shared.gustRate * 0.41, 0.12);
  const sweep = kit.lfo(band.frequency, shared.gustRate * 0.8, v.sweep);
  for (const [f, Q, g] of v.whistles || []) {
    const wb = kit.filter('bandpass', f, Q);
    const wg = kit.gain(g);
    kit.loop('white').connect(wb).connect(wg).connect(gust);
    kit.lfo(wb.frequency, 0.05 + rng() * 0.03, f * 0.18);
  }
  if (v.high) {
    const hp = kit.filter('highpass', 3800, 0.5);
    const hg = kit.gain(v.high);
    kit.loop('pink').connect(hp).connect(hg).connect(gust);
  }
  if (v.grit) {
    const hp = kit.filter('highpass', 5200, 0.5);
    const gg = kit.gain(v.grit);
    kit.loop('white').connect(hp).connect(gg).connect(gust);
  }

  /** A gust: the wind rises for a few seconds and settles (also the living-world event). */
  const gustAt = (t, strength = 1) => {
    gust.gain.setTargetAtTime(0.75 + 0.55 * strength, t, 1.1);
    gust.gain.setTargetAtTime(0.75, t + 2.5 + strength * 2, 2.2);
    band.frequency.setTargetAtTime(v.f * (1 + 0.25 * strength), t, 1.4);
    band.frequency.setTargetAtTime(v.f, t + 3 + strength * 2, 2.5);
  };
  const gusts = stream(rng, (t) => gustAt(t, range(rng, 0.4, 0.9)), 4);

  api.gustAt = gustAt;
  api.setConditions = (mult, c, tc) => {
    st.mult = mult;
    st.cond = c;
    glide(cond.gain, mult, ctx, tc);
    const rough = c.weather === 'windy' || c.weather === 'dust-wind' || c.weather === 'thunderstorm' ? 1.6 : 1;
    glide(swell.depth.gain, 0.22 * rough, ctx, tc);
  };
  api.apply = (p) => {
    st.params = p;
    glide(sweep.depth.gain, v.sweep * (0.5 + p.variation), ctx, 2);
  };
  api.schedule = (from, to) => {
    const rough = st.cond.weather === 'windy' || st.cond.weather === 'dust-wind' ? 0.05 : st.cond.weather === 'thunderstorm' ? 0.04 : 0.008;
    gusts(from, to, rough * (0.5 + st.params.variation));
  };
  api.randomize = (r) => glide(band.frequency, v.f * range(r, 0.88, 1.12), ctx, 4);
  api.evolve = (r) => glide(band.frequency, v.f * range(r, 0.85, 1.15), ctx, 15);
  return api;
}

// ── Foliage: grass, leaves, needles, reeds and brush, moving with the wind's gusts ─────

const FOLIAGE = {
  grass: { noise: 'pink', hp: 2600, lp: 9000, g: 0.5, am: 0.3 },
  leaves: { noise: 'pink', hp: 1700, lp: 7000, g: 0.45, am: 0.28, rustle: 0.15 },
  needles: { noise: 'white', hp: 5000, lp: 11000, g: 0.25, am: 0.3 },
  reeds: { noise: 'pink', bp: 3300, Q: 1.1, g: 0.5, am: 0.32, rustle: 0.1 },
  brush: { noise: 'pink', hp: 3300, lp: 8000, g: 0.35, am: 0.3, ticks: true },
};

function foliage(kit, variant, shared) {
  const v = FOLIAGE[variant] || FOLIAGE.grass;
  const { layer, cond, st, api } = base(kit, 'foliage', {}, shared);
  const { ctx, rng } = kit;
  const src = kit.loop(v.noise, { rate: 1.05 });
  let tone;
  if (v.bp) {
    tone = kit.filter('bandpass', v.bp, v.Q);
    src.connect(tone);
  } else {
    const hp = kit.filter('highpass', v.hp, 0.5);
    tone = kit.filter('lowpass', v.lp, 0.5);
    src.connect(hp).connect(tone);
  }
  const am = kit.gain(v.g);
  tone.connect(am).connect(cond);
  // The same rate as the wind's gusts (started together), so grass and wind swell as one.
  kit.lfo(am.gain, shared.gustRate, v.am * v.g);
  if (v.rustle) kit.lfo(am.gain, 0.23, v.rustle * v.g);
  const ticks = v.ticks
    ? stream(rng, (t) => kit.burst(t, {
      type: 'white', dest: layer.gain, filterType: 'bandpass', frequency: range(rng, 4500, 7500), Q: 3,
      level: range(rng, 0.04, 0.09), attack: 0.001, decay: range(rng, 0.004, 0.01),
    }), 20)
    : null;
  api.apply = (p) => {
    st.params = p;
    glide(tone.frequency, (v.bp || v.lp) * (1.1 - p.depth * 0.3), ctx, 2);
  };
  if (ticks) api.schedule = (from, to) => ticks(from, to, 2.2 * st.mult);
  return api;
}

// ── Water ─────────────────────────────────────────────────────────────────────────────

function water(kit, variant, shared) {
  const reverb = variant === 'ice' ? 0.55 : variant === 'falls' ? 0.25 : 0.2;
  const { layer, cond, st, api } = base(kit, 'water', { reverb, delay: variant === 'ice' ? 0.2 : 0 }, shared);
  const { ctx, rng } = kit;
  const dest = layer.gain;
  const streams = [];
  let shape = null;

  const bubbles = (lo, hi, rate, level) => streams.push([stream(rng, (t) => kit.chirp(t, range(rng, lo, hi), {
    dest, level: range(rng, level * 0.5, level), length: range(rng, 0.02, 0.05), rise: range(rng, 1.6, 2.2),
  }), 30), rate]);

  if (variant === 'creek') {
    const src = kit.loop('white', { rate: 0.9 });
    const low = kit.filter('bandpass', 1100, 0.7);
    const high = kit.filter('bandpass', 2600, 1.2);
    const babble = kit.gain(0.45);
    src.connect(low).connect(babble);
    src.connect(high).connect(babble);
    babble.connect(cond);
    kit.lfo(babble.gain, 4.3, 0.12);
    kit.lfo(low.frequency, 0.6, 180);
    shape = high;
    bubbles(500, 1400, 4, 0.03);
  } else if (variant === 'river') {
    const lp = kit.filter('lowpass', 1400, 0.5);
    const a = kit.gain(0.55);
    const deep = kit.filter('lowpass', 320, 0.5);
    const b = kit.gain(0.5);
    const swell = kit.gain(1);
    kit.loop('pink').connect(lp).connect(a).connect(swell);
    kit.loop('brown').connect(deep).connect(b).connect(swell);
    swell.connect(cond);
    kit.lfo(swell.gain, 0.07, 0.1);
    shape = lp;
    bubbles(300, 800, 1.5, 0.02);
  } else if (variant === 'falls') {
    const bp = kit.filter('bandpass', 1300, 0.45);
    const a = kit.gain(0.6);
    const deep = kit.filter('lowpass', 220, 0.5);
    const b = kit.gain(0.7);
    const hp = kit.filter('highpass', 6500, 0.5);
    const c = kit.gain(0.12);
    kit.loop('white').connect(bp).connect(a).connect(cond);
    kit.loop('brown').connect(deep).connect(b).connect(cond);
    kit.loop('white', { rate: 1.1 }).connect(hp).connect(c).connect(cond);
    kit.lfo(a.gain, 0.11, 0.05);
    shape = bp;
  } else if (variant === 'swamp') {
    const lp = kit.filter('lowpass', 280, 0.5);
    const a = kit.gain(0.55);
    const bp = kit.filter('bandpass', 700, 0.8);
    const b = kit.gain(0.08);
    kit.loop('brown').connect(lp).connect(a).connect(cond);
    kit.loop('pink').connect(bp).connect(b).connect(cond);
    kit.lfo(a.gain, 0.09, 0.2);
    kit.lfo(b.gain, 0.13, 0.05);
    shape = lp;
    streams.push([stream(rng, (t) => kit.chirp(t, range(rng, 130, 260), { dest, level: range(rng, 0.03, 0.05), length: 0.08, rise: 1.35 }), 6), 0.35]);
    bubbles(600, 1100, 0.5, 0.012);
  } else if (variant === 'dock' || variant === 'lake') {
    const lp = kit.filter('lowpass', 380, 0.5);
    const a = kit.gain(0.3);
    kit.loop('brown').connect(lp).connect(a).connect(cond);
    shape = lp;
    const lap = (t, level) => kit.burst(t, {
      type: 'pink', dest, filterType: 'lowpass', frequency: range(rng, 450, 800), Q: 0.7,
      level, attack: range(rng, 0.04, 0.08), decay: range(rng, 0.25, 0.45),
    });
    streams.push([stream(rng, (t) => {
      lap(t, range(rng, 0.12, 0.2));
      if (rng() < 0.6) lap(t + range(rng, 0.2, 0.35), range(rng, 0.05, 0.1));
    }, 8), 0.5]);
    if (variant === 'dock') {
      streams.push([stream(rng, (t) => kit.burst(t, {
        type: 'pink', dest, filterType: 'bandpass', frequency: range(rng, 380, 600), Q: 2,
        level: range(rng, 0.1, 0.16), attack: 0.005, decay: range(rng, 0.08, 0.14),
      }), 8), 0.45]);
    }
  } else if (variant === 'ice') {
    // Lake ice: the high "pew" of a crack running through it, slow creaks and a deep boom.
    streams.push([stream(rng, (t) => kit.whistle(t, [[0, range(rng, 2000, 3200)], [range(rng, 0.35, 0.6), range(rng, 140, 220)]], {
      dest, level: range(rng, 0.02, 0.04), attack: 0.005, release: 0.2,
    }), 4), 0.08]);
    streams.push([stream(rng, (t) => {
      const f = range(rng, 60, 85);
      kit.whistle(t, [[0, f], [0.4, f * range(rng, 1.1, 1.25)], [range(rng, 0.9, 1.6), f * 0.85]], {
        dest, type: 'sawtooth', level: 0.05, attack: 0.2, release: 0.4, filter: { type: 'bandpass', frequency: range(rng, 500, 900), Q: 2.5 },
      });
    }, 3), 0.05]);
    streams.push([stream(rng, (t) => kit.burst(t, {
      type: 'brown', dest, filterType: 'lowpass', frequency: 90, Q: 0.7, level: 0.35, attack: 0.02, decay: 0.8,
    }), 2), 0.02]);
  }

  api.apply = (p) => {
    st.params = p;
    if (shape) glide(shape.frequency, baseFreq(variant) * (1.1 - p.depth * 0.3), ctx, 2);
  };
  api.schedule = (from, to) => {
    for (const [s, rate] of streams) s(from, to, rate * st.mult * (0.6 + st.params.variation * 0.8));
  };
  return api;
}

const baseFreq = (variant) => ({ creek: 2600, river: 1400, falls: 1300, swamp: 280, dock: 380, lake: 380 }[variant] || 1000);

// ── Insects: cicadas by day, crickets after dark ──────────────────────────────────────

const INSECTS = {
  meadow: { cicada: [5600, 0.25, 38], crickets: [4300, 4700] },
  forest: { cicada: [5000, 0.15, 32], crickets: [4100, 4500, 4900] },
  desert: { cicada: [4300, 0.4, 48], crickets: [4600] },
  wetland: { cicada: [5200, 0.3, 42], crickets: [4200, 4600, 5000] },
};
// [dawn, morning, afternoon, evening, night]
const DAY = { dawn: 0.2, morning: 0.6, afternoon: 1, dusk: 0.35, night: 0 };
const NIGHT = { dawn: 0.35, morning: 0.05, afternoon: 0.1, dusk: 0.95, night: 1 };

function insects(kit, variant, shared) {
  const v = INSECTS[variant] || INSECTS.meadow;
  const { cond, st, api } = base(kit, 'insects', {}, shared);
  const { ctx, rng } = kit;
  const [cf, cg, rate] = v.cicada;
  const pitches = v.crickets.map((f) => f * range(rng, 0.98, 1.02));
  let chirps = [];

  // Cicadas: a band of noise buzzing at a fast rate, swelling slowly.
  const day = lazy(kit, cond, (out) => {
    const bp = kit.filter('bandpass', cf, 3);
    const am = kit.gain(0.5);
    const swell = kit.gain(0.6 * cg * 2);
    kit.loop('white').connect(bp).connect(am).connect(swell).connect(out);
    kit.lfo(am.gain, rate, 0.45);
    kit.lfo(swell.gain, 0.045, 0.4 * cg * 2);
  });
  // Crickets: a tone pulsed into chirps, each cricket at its own pitch and pace.
  const night = lazy(kit, cond, (out) => {
    chirps = pitches.map((f, i) => {
      const o = kit.osc('sine', f);
      const pulse = kit.gain(0.5);
      const chirp = kit.gain(0.5);
      const bp = kit.filter('bandpass', f, 6);
      const level = kit.gain(0.22);
      o.connect(pulse).connect(chirp).connect(bp).connect(level).connect(out);
      kit.lfo(pulse.gain, range(rng, 27, 33), 0.5, 'square');
      return kit.lfo(chirp.gain, (1.6 + i * 0.35) * (0.8 + st.params.mood * 0.5), 0.5, 'square');
    });
  });

  api.setConditions = (mult, c, tc) => {
    st.mult = mult;
    st.cond = c;
    glide(cond.gain, mult, ctx, tc);
    day.set((DAY[c.time] ?? 0.5) * (mult > 0.001 ? 1 : 0), tc);
    // Through dusk the crickets build, from a few to the full night chorus.
    const nightLevel = c.time === 'dusk' ? 0.35 + 0.65 * (c.progress ?? 0.5) : NIGHT[c.time] ?? 0.5;
    night.set(nightLevel * (mult > 0.001 ? 1 : 0), tc);
  };
  api.apply = (p) => {
    st.params = p;
    // Livelier: crickets chirp a little faster (they do when it's warm).
    if (night.active()) chirps.forEach((c, i) => glide(c.osc.frequency, (1.6 + i * 0.35) * (0.8 + p.mood * 0.5), ctx, 3));
  };
  api.schedule = (from) => {
    day.tick(from);
    night.tick(from);
  };
  return api;
}

// ── Frogs: peepers, bullfrogs and tree-frog trills ─────────────────────────────────────

function frogs(kit, variant, shared) {
  const { layer, st, api } = base(kit, 'frogs', {}, shared);
  const { rng } = kit;
  const dest = layer.gain;
  const callers = [];
  const add = (n, make) => {
    for (let i = 0; i < n; i += 1) callers.push({ ...make(), next: 0, restUntil: 0 });
  };
  const peeper = () => ({
    period: range(rng, 0.7, 1.3),
    call(t, f) { kit.chirp(t, f * range(rng, 0.98, 1.02), { dest, level: range(rng, 0.02, 0.035), length: 0.09, rise: 1.12 }); },
    f: range(rng, 2800, 3400),
  });
  const bullfrog = () => ({
    period: range(rng, 5, 11),
    call(t, f) {
      kit.trill(t, f, { dest, type: 'sawtooth', pulses: Math.round(range(rng, 2, 3)), rate: 5.5, duty: 0.65, level: 0.06, drop: 0.92, filter: { type: 'lowpass', frequency: 380, Q: 5 } });
    },
    f: range(rng, 90, 130),
  });
  const treefrog = () => ({
    period: range(rng, 6, 14),
    call(t, f) {
      kit.trill(t, f, { dest, type: 'square', pulses: Math.round(range(rng, 10, 16)), rate: 20, duty: 0.4, level: 0.015, filter: { type: 'bandpass', frequency: 2100, Q: 3 } });
    },
    f: range(rng, 1800, 2300),
  });
  if (variant === 'peepers') add(5, peeper);
  else if (variant === 'bullfrog') add(2, bullfrog);
  else {
    add(4, peeper);
    add(1, bullfrog);
    add(1, treefrog);
  }

  api.schedule = (from, to) => {
    const m = busy(st);
    for (const f of callers) {
      if (m < 0.05) {
        f.next = 0;
        continue;
      }
      if (f.next < from) f.next = from + rng() * f.period;
      let n = 0;
      while (f.next < to && n < 12) {
        if (f.next >= f.restUntil) {
          if (rng() < Math.min(1, m)) f.call(f.next, f.f);
          // A frog falls quiet for a while now and then: the chorus breathes.
          if (rng() < 0.03) f.restUntil = f.next + range(rng, 5, 15);
        }
        f.next += (f.period * range(rng, 0.85, 1.15)) / (0.5 + 0.5 * Math.min(1.5, m));
        n += 1;
      }
    }
  };
  return api;
}

// ── Birds ─────────────────────────────────────────────────────────────────────────────

const SONGS = [
  { count: [2, 4], freq: [2600, 3400], gap: [0.12, 0.2], rise: 1.3 },
  { count: [3, 6], freq: [3600, 4600], gap: [0.07, 0.12], rise: 1.15 },
  { count: [1, 2], freq: [1900, 2500], gap: [0.3, 0.5], rise: 1.5 },
];

function birdPhrases(kit, dest) {
  const { rng } = kit;
  const r = (a, b) => range(rng, a, b);
  return {
    chirps(t) {
      const song = weighted(rng, SONGS, [3, 2, 1]);
      const count = Math.round(r(song.count[0], song.count[1]));
      const f = r(song.freq[0], song.freq[1]);
      for (let i = 0; i < count; i += 1) {
        kit.chirp(t, f * r(0.94, 1.08), { dest, level: r(0.03, 0.055), length: r(0.06, 0.12), rise: song.rise });
        t += r(song.gap[0], song.gap[1]);
      }
    },
    // A slurred, falling flute-like song, as meadow birds sing from a fence post.
    meadowlark(t) {
      const f0 = r(2400, 3000);
      const shape = [1, 1.25, 0.95, 0.85, 1.05, 0.8, 0.75];
      const n = Math.round(r(5, 7));
      for (let i = 0; i < n; i += 1) {
        const len = r(0.08, 0.16);
        const f = f0 * shape[i];
        kit.whistle(t, [[0, f], [len, f * r(0.9, 1.08)]], { dest, level: 0.03, attack: 0.01, release: 0.04 });
        t += len + r(0.02, 0.06);
      }
    },
    sparrow(t) {
      const f = r(3800, 4800);
      const n = Math.round(r(3, 6));
      for (let i = 0; i < n; i += 1) {
        kit.chirp(t, f * r(0.95, 1.05), { dest, level: r(0.02, 0.035), length: r(0.04, 0.07), rise: 1.2 });
        t += r(0.07, 0.11);
      }
      kit.trill(t + 0.05, f * 0.9, { dest, type: 'sine', pulses: Math.round(r(6, 10)), rate: 22, duty: 0.5, level: 0.018 });
    },
    // A falling, ringing spiral of notes, as heard at the forest's edge.
    spiral(t) {
      let f = r(2800, 3300);
      const n = Math.round(r(4, 5));
      for (let i = 0; i < n; i += 1) {
        kit.whistle(t, [[0, f], [0.22, f * 0.97]], { dest, level: 0.02, attack: 0.02, release: 0.1, vibrato: { rate: 28, depth: 70 }, harmonic: 0.2 });
        t += 0.17;
        f *= 0.93;
      }
    },
    feebee(t) {
      const f = r(3700, 4000);
      kit.whistle(t, [[0, f], [0.3, f * 0.99]], { dest, level: 0.025, attack: 0.03, release: 0.08 });
      kit.whistle(t + 0.36, [[0, f * 0.85], [0.3, f * 0.84]], { dest, level: 0.022, attack: 0.03, release: 0.08 });
    },
    nasal(t) {
      kit.trill(t, r(850, 950), { dest, type: 'square', pulses: Math.round(r(3, 5)), rate: 6, duty: 0.5, level: 0.012, filter: { type: 'bandpass', frequency: 1300, Q: 3 } });
    },
    blackbird(t) {
      kit.chirp(t, 1500, { dest, level: 0.035, length: 0.08, rise: 1.4 });
      kit.chirp(t + 0.12, 2000, { dest, level: 0.03, length: 0.06, rise: 1.2 });
      kit.trill(t + 0.22, r(2600, 3000), { dest, type: 'sawtooth', pulses: 12, rate: 35, duty: 0.5, level: 0.018, drop: 1.05, filter: { type: 'bandpass', frequency: 3200, Q: 4 } });
    },
    heron(t) {
      kit.trill(t, r(250, 320), { dest, type: 'sawtooth', pulses: 3, rate: 9, duty: 0.7, level: 0.04, drop: 0.85, filter: { type: 'lowpass', frequency: 900, Q: 2 } });
    },
    rattle(t) {
      kit.trill(t, r(2800, 3200), { dest, type: 'square', pulses: Math.round(r(10, 16)), rate: 16, duty: 0.45, level: 0.012, filter: { type: 'bandpass', frequency: 3000, Q: 3 } });
    },
    // A soft, low cooing in four notes.
    dove(t) {
      const f = r(480, 540);
      const notes = [[f, f * 1.15, 0.35], [f * 1.15, f * 1.12, 0.45], [f * 0.95, f * 0.92, 0.3], [f * 0.95, f * 0.92, 0.3]];
      for (const [a, b, len] of notes) {
        kit.whistle(t, [[0, a], [len, b]], { dest, level: 0.03, attack: 0.06, release: 0.12, filter: { type: 'lowpass', frequency: 900, Q: 0.7 } });
        t += len + 0.1;
      }
    },
    wren(t) {
      kit.trill(t, r(2000, 2400), { dest, type: 'sawtooth', pulses: Math.round(r(6, 9)), rate: 10, duty: 0.55, level: 0.018, filter: { type: 'bandpass', frequency: 2400, Q: 3 } });
    },
    quail(t) {
      kit.whistle(t, [[0, 1700], [0.12, 1650]], { dest, level: 0.022, attack: 0.01, release: 0.04 });
      kit.whistle(t + 0.18, [[0, 1900], [0.18, 2400]], { dest, level: 0.028, attack: 0.01, release: 0.05 });
      kit.whistle(t + 0.42, [[0, 2000], [0.15, 1850]], { dest, level: 0.022, attack: 0.01, release: 0.05 });
    },
  };
}

const BIRDS = {
  meadow: { rate: 0.16, pool: [['meadowlark', 3], ['sparrow', 3], ['chirps', 2]] },
  forest: { rate: 0.2, pool: [['chirps', 3], ['spiral', 2], ['sparrow', 1]] },
  alpine: { rate: 0.08, pool: [['feebee', 3], ['nasal', 2], ['chirps', 1]] },
  wetland: { rate: 0.14, pool: [['blackbird', 3], ['heron', 1], ['rattle', 1], ['chirps', 1]] },
  desert: { rate: 0.09, pool: [['dove', 3], ['wren', 2], ['quail', 2]] },
};

function birds(kit, variant, shared) {
  const v = BIRDS[variant] || BIRDS.meadow;
  const { layer, st, api } = base(kit, 'birds', {}, shared);
  const { rng } = kit;
  const phrases = birdPhrases(kit, layer.gain);
  let pool = v.pool;
  let last = null;
  const sing = stream(rng, (t) => {
    // Rarely the same phrase twice running.
    const options = pool.filter(([id]) => id !== last || pool.length === 1);
    const [id] = weighted(rng, options, options.map(([, w]) => w));
    if (!allowed(st, t)) return;
    last = id;
    phrases[id](t);
  }, 6);
  // The dawn chorus builds as dawn goes on (with the world clock; held at its middle otherwise).
  const chorus = () => (st.cond.time === 'dawn' ? 0.6 + 0.8 * (st.cond.progress ?? 0.5) : 1);
  api.schedule = (from, to) => sing(from, to, v.rate * busy(st) * chorus());
  api.randomize = (r) => {
    pool = v.pool.map(([id, w]) => [id, w * range(r, 0.6, 1.4)]);
  };
  api.evolve = api.randomize;
  return api;
}

// ── Wildlife: the distant calls (all of them living-world events, events.js) ──────────

function wildlife(kit, variant, shared) {
  return base(kit, 'wildlife', {}, shared).api;
}

// ── Distant human activity ────────────────────────────────────────────────────────────

function distant(kit, variant, shared) {
  const { layer, cond, st, api } = base(kit, 'distant', {}, shared);
  const { rng } = kit;
  const dest = layer.gain;
  const r = (a, b) => range(rng, a, b);
  const streams = [];
  const every = (rate, fn, max = 4) => streams.push([stream(rng, (t) => allowed(st, t) && fn(t), max), rate]);
  const creak = (t, f, len, level, band) => kit.whistle(t, [[0, f], [len * 0.45, f * r(1.12, 1.25)], [len, f * r(0.95, 1.05)]], {
    dest, type: 'sawtooth', level, attack: len * 0.2, release: len * 0.3, filter: { type: 'bandpass', frequency: band, Q: 3.5 },
  });
  const bell = (t, f, level, decay) => {
    kit.tone(t, f, { dest, level, decay, kind: 'bell', bright: 3200 });
  };
  const knocks = (t, n, gap, f, level) => {
    for (let i = 0; i < n; i += 1) {
      kit.burst(t + i * gap * r(0.9, 1.1), { type: 'white', dest, filterType: 'bandpass', frequency: f * r(0.9, 1.1), Q: 2, level: level * r(0.8, 1.1), attack: 0.001, decay: 0.02 });
    }
  };
  const windmill = (t) => creak(t, r(85, 100), r(0.9, 1.2), 0.025, 900);
  const cowbells = (t) => {
    const n = Math.round(r(1, 3));
    for (let i = 0; i < n; i += 1) {
      const f = r(540, 600);
      bell(t + i * r(0.3, 0.7), f, 0.03, 0.5);
      bell(t + i * r(0.3, 0.7) + 0.005, f * 1.48, 0.015, 0.35);
    }
  };

  if (variant === 'ranch' || variant === 'farm') {
    every(0.13, windmill);
    every(variant === 'farm' ? 0.08 : 0.04, cowbells);
    every(variant === 'farm' ? 0.03 : 0.02, (t) => knocks(t, Math.round(r(3, 6)), 0.55, 2500, 0.07));
  } else if (variant === 'rail') {
    // Telegraph wires singing in the wind.
    const hum = kit.gain(1);
    const a = kit.filter('bandpass', 620, 14);
    const ag = kit.gain(0.5);
    const b = kit.filter('bandpass', 935, 16);
    const bg = kit.gain(0.35);
    const src = kit.loop('pink');
    src.connect(a).connect(ag).connect(hum);
    src.connect(b).connect(bg).connect(hum);
    hum.connect(cond);
    kit.lfo(hum.gain, shared.gustRate, 0.3);
  } else if (variant === 'settlement') {
    // Life going on across the water: indistinct, never words.
    const murmur = kit.filter('bandpass', 480, 1.4);
    const mg = kit.gain(0.14);
    kit.loop('pink').connect(murmur).connect(mg).connect(cond);
    kit.lfo(mg.gain, 0.37, 0.06);
    kit.lfo(mg.gain, 0.11, 0.05);
    every(0.03, (t) => {
      const n = Math.round(r(2, 5));
      for (let i = 0; i < n; i += 1) {
        const at = t + i * r(0.65, 0.8);
        bell(at, r(1500, 1750), 0.04, 0.6);
        kit.burst(at, { type: 'white', dest, filterType: 'bandpass', frequency: 3000, Q: 1.5, level: 0.05, attack: 0.001, decay: 0.01 });
      }
    });
    every(0.03, (t) => creak(t, r(115, 130), r(0.9, 1.2), 0.015, 1000));
    every(0.02, (t) => knocks(t, Math.round(r(3, 5)), 0.5, 500, 0.08));
  } else if (variant === 'dock') {
    every(0.12, (t) => creak(t, r(70, 90), r(0.9, 1.4), 0.03, r(600, 900)));
    every(0.08, (t) => {
      const at = [t];
      if (rng() < 0.4) at.push(t + r(0.15, 0.3));
      at.forEach((x) => kit.burst(x, { type: 'pink', dest, filterType: 'bandpass', frequency: r(300, 450), Q: 2, level: r(0.07, 0.1), attack: 0.004, decay: 0.06 }));
    });
  } else if (variant === 'cabin') {
    every(0.04, (t) => creak(t, r(55, 75), r(1, 1.6), 0.025, 500));
  } else if (variant === 'homestead') {
    // Loose tin rattling and a broken windmill.
    every(0.06, (t) => {
      const n = Math.round(r(5, 10));
      let at = t;
      for (let i = 0; i < n; i += 1) {
        kit.burst(at, { type: 'white', dest, filterType: 'bandpass', frequency: r(2500, 4500), Q: 6, level: r(0.025, 0.045), attack: 0.001, decay: 0.02 });
        at += r(0.05, 0.09);
      }
    }, 3);
    every(0.1, (t) => creak(t, r(65, 75), r(1.2, 1.7), 0.03, 700));
  }

  api.schedule = (from, to) => {
    const k = eventFactor(st.shared.tune.eventIntensity) * (st.shared.tune.lite ? 0.6 : 1);
    for (const [s, rate] of streams) s(from, to, rate * st.mult * k);
  };
  return api;
}

// ── Fire ─────────────────────────────────────────────────────────────────────────────

function fire(kit, variant, shared) {
  const stove = variant === 'stove';
  const { layer, cond, st, api } = base(kit, 'fire', {}, shared);
  const { ctx, rng } = kit;
  const dest = layer.gain;
  const lp = kit.filter('lowpass', stove ? 260 : 420, 0.6);
  const roar = kit.gain(stove ? 0.55 : 0.5);
  kit.loop('brown').connect(lp).connect(roar).connect(cond);
  const flicker = kit.lfo(roar.gain, 0.3, 0.12);
  kit.lfo(lp.frequency, 0.11, 80);
  const hp = kit.filter('highpass', 4500, 0.5);
  const hiss = kit.gain(stove ? 0.08 : 0.2);
  kit.loop('pink').connect(hp).connect(hiss).connect(cond);

  const crackle = stream(rng, (t) => {
    const pop = rng() < 0.08;
    kit.burst(t, {
      type: 'white', dest, filterType: pop ? 'bandpass' : 'highpass',
      frequency: pop ? range(rng, 500, 1100) : range(rng, stove ? 900 : 1500, stove ? 2500 : 4500), Q: pop ? 1.4 : 0.8,
      level: (pop ? range(rng, 0.25, 0.4) : range(rng, 0.05, 0.18)) * (stove ? 0.7 : 1), attack: 0.001, decay: pop ? range(rng, 0.03, 0.07) : range(rng, 0.004, 0.02),
    });
  }, 40);
  const ticks = stove ? stream(rng, (t) => kit.tone(t, range(rng, 2200, 2800), { dest, level: 0.01, decay: 0.1, kind: 'bell' }), 2) : null;

  api.apply = (p) => {
    st.params = p;
    glide(flicker.depth.gain, 0.05 + p.variation * 0.16, ctx, 2);
  };
  api.schedule = (from, to) => {
    crackle(from, to, (stove ? 1.5 + st.params.mood * 3 : 3 + st.params.mood * 6) * st.mult);
    ticks?.(from, to, 0.05);
  };
  return api;
}

// ── Weather: rain on the place's own surface, snow, wind-blown debris and thunder ─────

const SURFACES = {
  grass: { hp: 1400, bp: 3200, Q: 0.5, drop: [2500, 5500], decay: [0.006, 0.02], level: 1 },
  leaves: { hp: 1200, bp: 2600, Q: 0.6, drop: [1500, 4000], decay: [0.01, 0.03], level: 1 },
  water: { hp: 900, bp: 2000, Q: 0.5, plinks: true, level: 0.9 },
  rock: { hp: 1800, bp: 4200, Q: 0.5, drop: [3000, 7000], decay: [0.004, 0.012], level: 0.9 },
  roof: { hp: 700, bp: 1600, Q: 0.7, drop: [900, 2400], decay: [0.015, 0.04], level: 1.15 },
  sand: { hp: 2000, bp: 4000, Q: 0.5, drop: [2500, 6000], decay: [0.004, 0.012], level: 0.85 },
  snow: { hp: 1600, bp: 3800, Q: 0.5, drop: [2500, 6000], decay: [0.005, 0.015], level: 0.9 },
};

function weather(kit, variant, shared) {
  const s = SURFACES[variant] || SURFACES.grass;
  const { layer, cond, st, api } = base(kit, 'weather', {}, shared);
  const { ctx, rng } = kit;
  const dest = layer.gain;
  let bp = null;

  // Each part of the weather exists only while that weather does (lazy).
  const rain = lazy(kit, cond, (out) => {
    const hp = kit.filter('highpass', s.hp, 0.5);
    bp = kit.filter('bandpass', s.bp * (1.1 - st.params.depth * 0.25), s.Q);
    kit.loop('pink').connect(hp).connect(bp).connect(out);
  });
  const roar = lazy(kit, cond, (out) => {
    const lp = kit.filter('lowpass', 600, 0.5);
    kit.loop('brown').connect(lp).connect(out);
  });
  const snow = lazy(kit, cond, (out) => {
    const hp = kit.filter('highpass', 4500, 0.5);
    const lp = kit.filter('lowpass', 9000, 0.5);
    kit.loop('pink', { rate: 0.9 }).connect(hp).connect(lp).connect(out);
    const whoosh = kit.filter('bandpass', 700, 0.7);
    const wg = kit.gain(0.5);
    kit.loop('pink').connect(whoosh).connect(wg).connect(out);
    kit.lfo(wg.gain, 0.07, 0.2);
  });
  const debris = lazy(kit, cond, (out) => {
    const hp = kit.filter('highpass', variant === 'sand' ? 2800 : 3600, 0.5);
    const am = kit.gain(1);
    kit.loop('white').connect(hp).connect(am).connect(out);
    kit.lfo(am.gain, shared.gustRate, 0.5);
  });

  let mix = weatherMix('clear');
  const drops = stream(rng, (t) => {
    if (s.plinks) {
      kit.chirp(t, range(rng, 1200, 2400), { dest, level: range(rng, 0.008, 0.02), length: 0.025, rise: 1.6 });
      return;
    }
    kit.burst(t, {
      type: 'white', dest, filterType: 'bandpass', frequency: range(rng, s.drop[0], s.drop[1]), Q: 1.2,
      level: range(rng, 0.03, 0.09) * s.level, attack: 0.001, decay: range(rng, s.decay[0], s.decay[1]),
    });
  }, 60);

  const thunder = (t, near) => {
    if (near) kit.burst(t, { type: 'white', dest, filterType: 'bandpass', frequency: 1800, Q: 0.6, level: 0.1, attack: 0.002, decay: 0.25 });
    const n = Math.round(range(rng, 3, 5));
    for (let i = 0; i < n; i += 1) {
      kit.burst(t + range(rng, 0, 2.5), {
        type: 'brown', dest, filterType: 'lowpass', frequency: range(rng, near ? 160 : 100, near ? 300 : 180), Q: 0.7,
        level: range(rng, 0.18, 0.32) * (near ? 1 : 0.55), attack: range(rng, 0.08, 0.5), decay: range(rng, 1.5, 4), sweepTo: range(rng, 60, 90),
      });
    }
  };
  let nextThunder = 0;

  // Weather Intensity scales how much rain, snow and grit there is, and how often it thunders.
  const strength = () => weatherFactor(st.shared.tune.weatherIntensity);
  api.setConditions = (mult, c, tc) => {
    st.mult = mult;
    st.cond = c;
    mix = weatherMix(c.weather);
    const k = strength();
    glide(cond.gain, mult, ctx, tc);
    rain.set(Math.min(1.6, mix.rain ** 1.1 * 1.5 * k) * s.level, tc);
    roar.set(mix.rain > 0.6 ? (mix.rain - 0.5) * 0.8 * k : 0, tc);
    snow.set(mix.snow * 0.35 * k, tc);
    debris.set(mix.debris * 0.16 * k, tc);
  };
  /** A storm on its way: a distant roll of thunder before the rain arrives. */
  api.distantThunder = (t) => thunder(t, false);
  api.apply = (p) => {
    st.params = p;
    if (bp && rain.active()) glide(bp.frequency, s.bp * (1.1 - p.depth * 0.25), ctx, 2);
  };
  api.schedule = (from, to) => {
    for (const bed of [rain, roar, snow, debris]) bed.tick(from);
    drops(from, to, mix.rain * 25 * Math.min(1.4, strength()));
    if (mix.thunder <= 0) {
      nextThunder = 0;
      return;
    }
    const base = mix.thunder >= 1 ? [18, 45] : mix.thunder >= 0.1 ? [120, 260] : [300, 600];
    const gap = base.map((g) => g / strength());
    if (nextThunder < from) nextThunder = from + range(rng, gap[0] * 0.3, gap[1]);
    if (nextThunder < to) {
      thunder(nextThunder, mix.thunder >= 1 && rng() < 0.35);
      nextThunder += range(rng, gap[0], gap[1]);
    }
  };
  return api;
}

const BUILDERS = { air, wind, foliage, water, insects, frogs, birds, wildlife, distant, fire, weather };

/** Builds a location's layer from its catalogue definition. */
export function buildLayer(kit, def, shared) {
  const make = BUILDERS[def.kind];
  if (!make) throw new Error(`Unknown Frontier sound: ${def.kind}`);
  return make(kit, def.variant, shared);
}

export const LAYER_KINDS = Object.keys(BUILDERS);
