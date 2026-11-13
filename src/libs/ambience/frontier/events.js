// Living-world events: the occasional distant sound that makes a place feel inhabited (a hawk
// overhead, coyotes at night, a train across the plain, a church bell over the water). Each
// location lists its own pool (catalogue.js); a director plays one now and then:
//   - only events that suit the hour and the weather, into a layer that's audible now (so a
//     muted or silent layer gets no events, and the event takes that layer's level)
//   - never two at once, never the same one twice running, each with its own cooldown
//   - sparse: half a minute to a couple of minutes apart (Variation makes it busier)
// Picking is a pure function (pickEvent), so it can be tested; playing uses the voice kit.
//
// Each event plays through its own short-lived bus: a gain no higher than its `ceiling`, a
// low-pass and level for its `distance` (0 near … 1 far: duller and quieter), and a place in
// the stereo field within its `pan` range. Calls marked `answer` may be answered a moment
// later from the other side, further off. A shared budget (createBudget) caps how many
// notable sounds start close together, the director's and the layers' own (birds, distant
// life) alike.
import { range, weighted } from '../random.js';

const NIGHTISH = ['dusk', 'night'];
const DAYTIME = ['morning', 'afternoon'];
const NOT_STORMY = ['clear', 'partly-cloudy', 'overcast', 'fog', 'windy', 'dust-wind', 'light-rain', 'snowfall'];
const FAIR = ['clear', 'partly-cloudy', 'overcast', 'windy', 'dust-wind'];

/**
 * The event library. `layers`: the kinds it can play into, first audible one wins; `times` /
 * `weathers`: when it can happen (all if left out); `cooldown`: seconds before it can come
 * again; `weight`: how likely when it can; `play(kit, t, dest, rng, api)` → its length (s).
 */
export const EVENTS = Object.freeze({
  hawk: {
    ceiling: 0.8, pan: [-0.8, 0.8], distance: [0.3, 0.8],
    label: 'Hawk overhead', layers: ['wildlife', 'birds'], times: ['morning', 'afternoon', 'dusk'], weathers: FAIR, cooldown: 120, weight: 2,
    play(kit, t, dest, rng) {
      const f = range(rng, 2800, 3200);
      kit.whistle(t, [[0, f], [0.15, f * 1.05], [0.9, f * 0.72]], {
        dest, type: 'sawtooth', level: 0.016, attack: 0.03, release: 0.3, vibrato: { rate: 24, depth: 60 }, filter: { type: 'bandpass', frequency: 2700, Q: 2 },
      });
      if (rng() < 0.5) {
        kit.whistle(t + 1.4, [[0, f * 0.98], [0.7, f * 0.74]], { dest, type: 'sawtooth', level: 0.012, attack: 0.03, release: 0.25, vibrato: { rate: 24, depth: 50 }, filter: { type: 'bandpass', frequency: 2600, Q: 2 } });
      }
      return 2.4;
    },
  },
  eagle: {
    ceiling: 0.7, pan: [-0.7, 0.7], distance: [0.5, 0.9],
    label: 'Eagle far below', layers: ['wildlife', 'birds'], times: ['dawn', 'morning', 'afternoon'], weathers: FAIR, cooldown: 150, weight: 2,
    play(kit, t, dest, rng) {
      let at = t;
      const n = Math.round(range(rng, 4, 6));
      for (let i = 0; i < n; i += 1) {
        const f = range(rng, 2800, 3200) * (1 - i * 0.03);
        kit.whistle(at, [[0, f], [0.09, f * 1.08], [0.16, f * 0.9]], { dest, level: 0.014, attack: 0.01, release: 0.05 });
        at += range(rng, 0.16, 0.22);
      }
      return at - t + 0.5;
    },
  },
  coyote: {
    ceiling: 0.85, pan: [-0.9, 0.9], distance: [0.4, 0.9], answer: 0.5,
    label: 'Coyotes calling', layers: ['wildlife'], times: ['dawn', ...NIGHTISH], weathers: NOT_STORMY, cooldown: 240, weight: 3,
    play(kit, t, dest, rng) {
      // A few voices: yips, then howls, overlapping.
      const voices = Math.round(range(rng, 2, 4));
      let end = 0;
      for (let v = 0; v < voices; v += 1) {
        const k = range(rng, 0.85, 1.2);
        let at = t + v * range(rng, 0.3, 1.2);
        const yips = Math.round(range(rng, 3, 6));
        for (let i = 0; i < yips; i += 1) {
          kit.whistle(at, [[0, 900 * k], [0.05, 1300 * k], [0.12, 950 * k]], { dest, level: 0.018, attack: 0.01, release: 0.04, filter: { type: 'lowpass', frequency: 2500, Q: 0.7 } });
          at += range(rng, 0.14, 0.24);
        }
        const len = range(rng, 1.2, 1.8);
        kit.whistle(at, [[0, 600 * k], [0.3, 1000 * k], [len * 0.7, 950 * k], [len, 700 * k]], {
          dest, level: 0.022, attack: 0.12, release: 0.4, vibrato: { rate: 5, depth: 15 }, harmonic: 0.25, filter: { type: 'lowpass', frequency: 2600, Q: 0.7 },
        });
        end = Math.max(end, at + len - t);
      }
      return end + 1;
    },
  },
  wolf: {
    ceiling: 0.85, pan: [-0.9, 0.9], distance: [0.5, 1], answer: 0.45,
    label: 'A wolf howling', layers: ['wildlife'], times: ['dawn', ...NIGHTISH], weathers: ['clear', 'partly-cloudy', 'overcast', 'fog', 'windy', 'snowfall'], cooldown: 300, weight: 2,
    play(kit, t, dest, rng) {
      const howl = (at, k, level) => kit.whistle(at, [[0, 380 * k], [0.5, 560 * k], [2, 540 * k], [2.8, 420 * k]], {
        dest, level, attack: 0.3, release: 0.7, vibrato: { rate: 4.5, depth: 6 }, harmonic: 0.25, filter: { type: 'lowpass', frequency: 1800, Q: 0.7 },
      });
      howl(t, range(rng, 0.9, 1.1), 0.03);
      if (rng() < 0.5) howl(t + range(rng, 1, 2), range(rng, 1.15, 1.3), 0.02);
      return 5;
    },
  },
  owl: {
    ceiling: 0.9, pan: [-0.8, 0.8], distance: [0.1, 0.6], answer: 0.55,
    label: 'An owl', layers: ['wildlife', 'birds'], times: NIGHTISH, weathers: NOT_STORMY, cooldown: 150, weight: 3,
    play(kit, t, dest, rng) {
      const f = range(rng, 330, 380);
      const pattern = [[0, 0.22], [0.42, 0.14], [0.6, 0.3], [1.1, 0.3]];
      for (const [at, len] of pattern) {
        kit.whistle(t + at, [[0, f], [len, f * 0.96]], { dest, level: 0.05, attack: 0.04, release: 0.1, filter: { type: 'lowpass', frequency: 800, Q: 0.7 } });
      }
      return 2;
    },
  },
  elk: {
    ceiling: 0.85, pan: [-0.9, 0.9], distance: [0.4, 0.9], answer: 0.35,
    label: 'An elk bugling', layers: ['wildlife'], times: ['dawn', 'dusk'], weathers: NOT_STORMY, cooldown: 300, weight: 2,
    play(kit, t, dest, rng) {
      const k = range(rng, 0.9, 1.1);
      kit.whistle(t, [[0, 650 * k], [0.6, 1500 * k], [1.4, 1900 * k], [2.2, 1850 * k], [2.6, 700 * k]], {
        dest, level: 0.02, attack: 0.15, release: 0.3, harmonic: 0.35, vibrato: { rate: 6, depth: 12 },
      });
      kit.trill(t + 2.8, 120, { dest, type: 'sawtooth', pulses: 4, rate: 5, duty: 0.6, level: 0.03, filter: { type: 'lowpass', frequency: 500, Q: 2 } });
      return 4;
    },
  },
  cattle: {
    label: 'Cattle lowing', layers: ['distant'], times: ['dawn', 'morning', 'afternoon', 'dusk'], weathers: ['clear', 'partly-cloudy', 'overcast', 'fog', 'windy', 'light-rain'], cooldown: 150, weight: 2,
    ceiling: 0.85, pan: [-0.8, 0.8], distance: [0.4, 0.9], answer: 0.4,
    play(kit, t, dest, rng) {
      const f = range(rng, 120, 160);
      const len = range(rng, 1.4, 2.2);
      kit.whistle(t, [[0, f], [len * 0.25, f * 1.22], [len * 0.7, f * 1.12], [len, f * 0.85]], {
        dest, type: 'sawtooth', level: 0.035, attack: 0.18, release: 0.45, harmonic: 0.3, vibrato: { rate: 5, depth: 3 },
        filter: { type: 'lowpass', frequency: range(rng, 700, 950), Q: 3.5 },
      });
      return len + 1;
    },
  },
  gust: {
    label: 'A gust of wind', layers: ['wind'], cooldown: 60, weight: 2,
    play(kit, t, dest, rng, api) {
      api.gustAt?.(t, range(rng, 0.8, 1.2));
      return 6;
    },
  },
  'branch-creak': {
    ceiling: 0.8, pan: [-0.7, 0.7], distance: [0, 0.4],
    label: 'A branch creaking', layers: ['wind', 'foliage'], cooldown: 90, weight: 2,
    play(kit, t, dest, rng) {
      const f = range(rng, 70, 110);
      const len = range(rng, 0.8, 1.5);
      kit.whistle(t, [[0, f], [len * 0.5, f * 1.3], [len, f * 1.05]], {
        dest, type: 'sawtooth', level: 0.03, attack: len * 0.3, release: len * 0.3, filter: { type: 'bandpass', frequency: range(rng, 600, 1000), Q: 4 },
      });
      return len + 0.5;
    },
  },
  woodpecker: {
    ceiling: 0.8, pan: [-0.8, 0.8], distance: [0.2, 0.7],
    label: 'A woodpecker', layers: ['birds'], times: ['dawn', 'morning', 'afternoon'], weathers: NOT_STORMY, cooldown: 120, weight: 2,
    play(kit, t, dest, rng) {
      const n = Math.round(range(rng, 12, 20));
      const f = range(rng, 1100, 1500);
      let at = t;
      for (let i = 0; i < n; i += 1) {
        kit.burst(at, { type: 'white', dest, filterType: 'bandpass', frequency: f, Q: 3, level: range(rng, 0.05, 0.08) * (1 - i / (n * 1.6)), attack: 0.001, decay: 0.012 });
        at += 1 / (18 - (i / n) * 4);
      }
      return at - t + 0.5;
    },
  },
  'fish-splash': {
    ceiling: 0.8, pan: [-0.6, 0.6], distance: [0, 0.5],
    label: 'A fish jumping', layers: ['water'], weathers: NOT_STORMY, cooldown: 90, weight: 2,
    play(kit, t, dest, rng) {
      kit.burst(t, { type: 'pink', dest, filterType: 'bandpass', frequency: range(rng, 900, 1500), Q: 0.8, level: 0.12, attack: 0.003, decay: 0.12 });
      kit.burst(t + 0.02, { type: 'brown', dest, filterType: 'lowpass', frequency: 300, Q: 0.7, level: 0.12, attack: 0.005, decay: 0.15 });
      for (let i = 0; i < 4; i += 1) kit.chirp(t + 0.1 + i * range(rng, 0.04, 0.09), range(rng, 600, 1200), { dest, level: 0.012, length: 0.03, rise: 1.8 });
      return 1;
    },
  },
  rockfall: {
    ceiling: 0.7, pan: [-0.8, 0.8], distance: [0.3, 0.8],
    label: 'Stones trickling down', layers: ['air', 'wind'], cooldown: 180, weight: 1,
    play(kit, t, dest, rng) {
      const n = Math.round(range(rng, 5, 10));
      let at = t;
      for (let i = 0; i < n; i += 1) {
        kit.burst(at, { type: 'white', dest, filterType: 'bandpass', frequency: range(rng, 1500, 3500), Q: 2, level: range(rng, 0.04, 0.09), attack: 0.001, decay: range(rng, 0.01, 0.03) });
        at += range(rng, 0.06, 0.25);
      }
      return at - t + 0.5;
    },
  },
  'far-train': {
    ceiling: 0.8, pan: [-0.6, 0.6], distance: [0.8, 1],
    label: 'A train far off', layers: ['distant', 'air'], cooldown: 420, weight: 1,
    play(kit, t, dest, rng) {
      trainWhistle(kit, t, dest, rng, 0.012, 700);
      if (rng() < 0.6) trainWhistle(kit, t + 2.6, dest, rng, 0.01, 700);
      return 6;
    },
  },
  train: {
    label: 'A train passing', layers: ['distant'], cooldown: 240, weight: 3,
    play(kit, t, dest, rng) {
      return trainPass(kit, t, dest, rng);
    },
  },
  steamboat: {
    ceiling: 0.8, pan: [-0.6, 0.6], distance: [0.6, 1],
    label: 'A steamboat whistle', layers: ['distant'], cooldown: 300, weight: 2,
    play(kit, t, dest, rng) {
      const k = range(rng, 0.92, 1.08);
      for (const f of [160, 200, 240]) {
        kit.whistle(t, [[0, f * k * 0.97], [0.3, f * k], [2.5, f * k * 0.98]], { dest, type: 'sawtooth', level: 0.012, attack: 0.25, release: 0.6, filter: { type: 'lowpass', frequency: 700, Q: 0.8 } });
      }
      return 4;
    },
  },
  'church-bell': {
    ceiling: 0.8, pan: [-0.5, 0.5], distance: [0.5, 0.9],
    label: 'A bell across the water', layers: ['distant'], times: ['morning', 'afternoon', 'dusk'], cooldown: 360, weight: 2,
    play(kit, t, dest, rng) {
      const n = Math.round(range(rng, 3, 6));
      for (let i = 0; i < n; i += 1) {
        kit.tone(t + i * 2.2, 196, { dest, level: 0.05, decay: 7, kind: 'bell', bright: 2600 });
        kit.tone(t + i * 2.2, 196 * 2.4, { dest, level: 0.015, decay: 4, kind: 'bell', bright: 3000 });
      }
      return n * 2.2 + 3;
    },
  },
  axe: {
    ceiling: 0.8, pan: [-0.7, 0.7], distance: [0.3, 0.8],
    label: 'Someone chopping wood', layers: ['distant'], times: DAYTIME, weathers: NOT_STORMY, cooldown: 300, weight: 2,
    play(kit, t, dest, rng) {
      const n = Math.round(range(rng, 4, 8));
      let at = t;
      for (let i = 0; i < n; i += 1) {
        kit.burst(at, { type: 'white', dest, filterType: 'bandpass', frequency: range(rng, 1000, 1400), Q: 1, level: 0.1, attack: 0.001, decay: 0.06 });
        kit.burst(at + 0.005, { type: 'brown', dest, filterType: 'lowpass', frequency: 220, Q: 0.7, level: 0.14, attack: 0.002, decay: 0.1 });
        at += range(rng, 1.2, 1.7);
      }
      return at - t + 1;
    },
  },
  'barn-door': {
    ceiling: 0.8, pan: [-0.6, 0.6], distance: [0.2, 0.6],
    label: 'A barn door', layers: ['distant'], times: ['dawn', 'morning', 'afternoon', 'dusk'], cooldown: 240, weight: 2,
    play(kit, t, dest, rng) {
      creakAt(kit, t, dest, rng, range(rng, 140, 180), 1.3);
      kit.burst(t + 1.4, { type: 'brown', dest, filterType: 'lowpass', frequency: 300, Q: 0.7, level: 0.12, attack: 0.003, decay: 0.15 });
      return 2.5;
    },
  },
  'door-creak': {
    ceiling: 0.8, pan: [-0.6, 0.6], distance: [0, 0.5],
    label: 'A door creaking', layers: ['distant'], cooldown: 200, weight: 2,
    play(kit, t, dest, rng) {
      creakAt(kit, t, dest, rng, range(rng, 150, 220), range(rng, 1, 1.8));
      return 2.5;
    },
  },
  'shutter-bang': {
    ceiling: 0.75, pan: [-0.6, 0.6], distance: [0, 0.4],
    label: 'A loose shutter', layers: ['distant'], weathers: ['clear', 'partly-cloudy', 'overcast', 'windy', 'dust-wind', 'thunderstorm'], cooldown: 180, weight: 2,
    play(kit, t, dest, rng) {
      kit.burst(t, { type: 'brown', dest, filterType: 'lowpass', frequency: 400, Q: 0.7, level: 0.14, attack: 0.002, decay: 0.15 });
      if (rng() < 0.6) kit.burst(t + range(rng, 0.25, 0.5), { type: 'brown', dest, filterType: 'lowpass', frequency: 380, Q: 0.7, level: 0.07, attack: 0.002, decay: 0.1 });
      return 1.5;
    },
  },
  'fire-pop': {
    ceiling: 0.9, pan: [-0.2, 0.2], distance: [0, 0.1],
    label: 'The fire settling', layers: ['fire'], cooldown: 60, weight: 2,
    play(kit, t, dest, rng) {
      kit.burst(t, { type: 'white', dest, filterType: 'bandpass', frequency: range(rng, 600, 1000), Q: 1.2, level: 0.35, attack: 0.001, decay: 0.06 });
      for (let i = 0; i < 6; i += 1) {
        kit.burst(t + 0.05 + i * range(rng, 0.03, 0.08), { type: 'white', dest, filterType: 'highpass', frequency: range(rng, 2500, 5000), Q: 0.8, level: range(rng, 0.05, 0.12), attack: 0.001, decay: 0.01 });
      }
      return 1;
    },
  },
});

function creakAt(kit, t, dest, rng, f, len) {
  kit.whistle(t, [[0, f], [len * 0.3, f * 1.35], [len * 0.7, f * 1.1], [len, f * 1.25]], {
    dest, type: 'sawtooth', level: 0.025, attack: 0.15, release: 0.25, filter: { type: 'bandpass', frequency: range(rng, 900, 1400), Q: 5 },
  });
}

function trainWhistle(kit, t, dest, rng, level, cutoff) {
  const k = range(rng, 0.95, 1.05);
  for (const f of [290, 360, 435]) {
    kit.whistle(t, [[0, f * k], [1.8, f * k * 0.97]], { dest, type: 'sawtooth', level, attack: 0.2, release: 0.4, filter: { type: 'lowpass', frequency: cutoff, Q: 0.7 } });
  }
}

/**
 * A train crossing the plain: the rumble rises and falls over about half a minute, with the
 * wheels' rhythm on the rails and the whistle as it nears. Built from a few long-lived nodes
 * (two noise sources, filters, gains and a pulse), not hundreds of separate clicks.
 */
function trainPass(kit, t, dest, rng) {
  const { ctx } = kit;
  const len = range(rng, 28, 40);
  const peak = t + len * range(rng, 0.4, 0.55);
  const env = (g, top) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(top * 0.15, t + len * 0.2);
    g.gain.linearRampToValueAtTime(top, peak);
    g.gain.linearRampToValueAtTime(top * 0.12, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0, t + len);
  };
  const rumble = ctx.createBufferSource();
  rumble.buffer = kit.noise('brown');
  rumble.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 140;
  const rg = ctx.createGain();
  env(rg, 0.4);
  rumble.connect(lp).connect(rg);

  // The wheels: a band of noise opened and closed by a pulse, at a speed that eases.
  const clatter = ctx.createBufferSource();
  clatter.buffer = kit.noise('pink');
  clatter.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 1.2;
  const gate = ctx.createGain();
  gate.gain.value = 0.5;
  const pulse = ctx.createOscillator();
  pulse.type = 'square';
  pulse.frequency.setValueAtTime(3.2, t);
  pulse.frequency.linearRampToValueAtTime(2.9, t + len);
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  pulse.connect(depth).connect(gate.gain);
  const cg = ctx.createGain();
  env(cg, 0.12);
  clatter.connect(bp).connect(gate).connect(cg);

  const out = ctx.createGain();
  out.gain.value = 1;
  rg.connect(out);
  cg.connect(out);
  const panner = kit.route(out, dest, kit.placeFor(dest));
  for (const s of [rumble, clatter, pulse]) {
    s.start(t, s.buffer ? rng() * 5 : undefined);
    s.stop(t + len + 0.1);
  }
  kit.custom([rumble, clatter, pulse, lp, rg, bp, gate, depth, cg, out, ...(panner ? [panner] : [])], t + len + 0.1);
  trainWhistle(kit, peak - range(rng, 8, 12), dest, rng, 0.02, 1100);
  return len;
}

/**
 * Seconds to the next event: sparse, busier with Variation and with Event Intensity (0 → 0.3×
 * as often, 0.5 → as designed, 1 → 1.7×).
 */
export const eventGap = (rng, variation = 0.45, intensity = 0.5) => range(rng, 35, 95) / (0.6 + variation * 0.9) / (0.3 + 1.4 * intensity);

/**
 * The place's event budget: at most `max()` notable sounds may start within any `window`
 * seconds (birds' phrases, distant life, the director's events). Busier with Event Intensity.
 */
export function createBudget({ window = 6, max = () => 3 } = {}) {
  const starts = [];
  return {
    take(t, cost = 1) {
      while (starts.length && starts[0] < t - window) starts.shift();
      const inWindow = starts.filter((s) => s > t - window && s <= t + window).length;
      if (inWindow + cost > max()) return false;
      for (let i = 0; i < cost; i += 1) starts.push(t);
      starts.sort((a, b) => a - b);
      return true;
    },
    /** For tests and diagnostics. */
    count: (t) => starts.filter((s) => s > t - window && s <= t + window).length,
  };
}

/** How many notable sounds the budget allows together, by Event Intensity. */
export const budgetMax = (intensity = 0.5) => Math.round(2 + 2 * intensity);

/**
 * An event's bus into its layer: ceiling, distance and stereo place. Built from a few nodes
 * that are freed with the event.
 */
function eventBus(kit, e, rng, at, length, { side = null, further = 0 } = {}) {
  const { ctx } = kit;
  const [d0, d1] = e.distance || [0, 0];
  const distance = Math.min(1, range(rng, d0, d1) + further);
  const g = ctx.createGain();
  g.gain.value = (e.ceiling ?? 1) * (1 - distance * 0.45);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 9000 * (1 - distance) + 1600 * distance;
  lp.Q.value = 0.5;
  g.connect(lp);
  const [p0, p1] = e.pan || [0, 0];
  let pan = range(rng, p0, p1);
  if (side !== null) pan = -Math.sign(side || 1) * Math.max(Math.abs(pan), 0.35); // the other side
  const nodes = [g, lp];
  let last = lp;
  if (typeof ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.02) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    lp.connect(p);
    nodes.push(p);
    last = p;
  }
  return {
    input: g,
    pan,
    connect(dest) {
      last.connect(dest);
      kit.custom(nodes, at + length + 4.5); // long enough for the calls' tails
    },
  };
}

/**
 * Which event plays next, or null. Pure: `audible(kind)` says whether a layer of that kind is
 * in the place and can be heard now; `history` is [{ id, at }] (most recent last).
 */
export function pickEvent({ pool, time, weather, now, history = [], audible, rng }) {
  const last = history[history.length - 1]?.id ?? null;
  const options = [];
  for (const id of pool || []) {
    const e = EVENTS[id];
    if (!e || id === last) continue;
    if (e.times && !e.times.includes(time)) continue;
    if (e.weathers && !e.weathers.includes(weather)) continue;
    const prev = [...history].reverse().find((h) => h.id === id);
    if (prev && now - prev.at < e.cooldown) continue;
    const layer = e.layers.find((k) => audible(k));
    if (!layer) continue;
    options.push({ id, layer, weight: e.weight });
  }
  if (!options.length) return null;
  return weighted(rng, options, options.map((o) => o.weight));
}

/**
 * The director for one location: schedules at most one event at a time from its pool.
 * `layers` maps a kind to { gain, api } for the location's layers.
 */
export function createDirector({ kit, pool, layers, rng, budget = null, tune = { eventIntensity: 0.5, lite: false } }) {
  let nextAt = 0;
  let busyUntil = 0;
  const history = [];
  let cond = { time: 'afternoon', weather: 'clear' };
  let variation = 0.45;
  let mults = {};
  let answer = null; // { id, at, layer, side }

  const play = (id, layerKind, at, opts = {}) => {
    const e = EVENTS[id];
    const target = layers.get(layerKind);
    // A rough length first (for the bus's lifetime), then the real one from the event.
    const bus = eventBus(kit, e, rng, at, 45, opts);
    const length = e.play(kit, at, bus.input, rng, target.api) || 2;
    bus.connect(target.gain);
    return { length, pan: bus.pan };
  };

  const audible = (kind) => {
    const l = layers.get(kind);
    return Boolean(l) && l.gain.gain.value > 0.001 && (mults[kind] ?? 1) > 0.05;
  };

  return {
    setConditions(c, m) {
      cond = c;
      mults = m;
    },
    apply(p) { variation = p.variation; },
    schedule(from, to) {
      // An answer from the other side, further off (part of the same moment: no new gap).
      if (answer && answer.at < to) {
        const a = answer;
        answer = null;
        if (a.at >= from - 1 && audible(a.layer) && (!budget || budget.take(a.at))) {
          const { length } = play(a.id, a.layer, Math.max(a.at, from), { side: a.side, further: 0.25 });
          busyUntil = Math.max(busyUntil, a.at + length);
          history.push({ id: a.id, at: a.at, answer: true });
          if (history.length > 12) history.shift();
        }
      }
      if (!nextAt || nextAt < from - 5) nextAt = from + range(rng, 12, 30);
      const at = Math.max(nextAt, busyUntil + 2);
      if (at >= to) return;
      const real = history.filter((h) => !h.answer);
      const pick = pickEvent({ pool, time: cond.time, weather: cond.weather, now: at, history: real, audible, rng });
      if (pick && (!budget || budget.take(at, 2))) {
        const { length, pan } = play(pick.id, pick.layer, at);
        busyUntil = at + length;
        history.push({ id: pick.id, at });
        if (history.length > 12) history.shift();
        const chance = EVENTS[pick.id].answer || 0;
        if (chance && rng() < chance) answer = { id: pick.id, layer: pick.layer, side: pan || 1, at: at + length + range(rng, 1, 4) };
      }
      nextAt = at + eventGap(rng, variation, tune.eventIntensity) * (tune.lite ? 2 : 1);
    },
    /** For tests and diagnostics. */
    history: () => [...history],
  };
}
