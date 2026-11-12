// Living Atmosphere: how an environment slowly changes while it plays. Pure functions (the
// engine applies the result on the audio clock), so the behaviour is testable and, from a
// seed, repeatable.
//
// Evolution moves each layer's *evolution* gain (a multiplier after the user's mix slider:
// the user's level is never changed, and a layer at 0 stays silent), nudges Mood, Variation
// and Depth a little around the user's settings, and now and then asks the environment for a
// gentle harmonic change (its `evolve(rng)`). Steps are minutes apart and every change is a
// long ramp, so it never sounds like one track ending and another starting.
//
// An environment describes its evolution with
//   evolution: { layers: { [id]: { range: [low, high], start } }, params: { mood, variation, depth } }
// `range` is how far a layer may go (× its mix level), `start` where it opens (Dreamscape opens
// on pads, with the piano arriving later), `params` how far each character control may drift.
import { range } from './random.js';

export const EVOLUTION_MODES = ['off', 'gentle', 'dynamic', 'organic'];

export const EVOLUTION_LABELS = {
  off: { label: 'Off', hint: 'The sound keeps its character.' },
  gentle: { label: 'Gentle', hint: 'Slow, subtle changes every few minutes.' },
  dynamic: { label: 'Dynamic', hint: 'More noticeable changes, still smooth.' },
  organic: { label: 'Organic', hint: 'Less predictable, always within the environment.' },
};

// first: seconds to the first step; wait: between steps; tc: ramp time constant (≈ 3× to
// settle); reach: how much of a layer's range is used; step: the largest change in one step;
// params: how much of the parameter drift is used; harmonic: chance of a harmonic change;
// keep: chance a layer is left as it is (organic).
const MODES = {
  gentle: { first: [45, 90], wait: [100, 190], tc: [22, 38], reach: 0.6, step: 0.3, params: 0.55, harmonic: 0.18, keep: 0 },
  dynamic: { first: [25, 45], wait: [45, 90], tc: [9, 16], reach: 1, step: 0.55, params: 1, harmonic: 0.35, keep: 0 },
  organic: { first: [20, 70], wait: [25, 160], tc: [6, 34], reach: 0.9, step: 0.7, params: 0.85, harmonic: 0.28, keep: 0.4 },
};

const DEFAULT_RANGE = [0.75, 1.1];
const PARAM_NAMES = ['mood', 'variation', 'depth'];
const LOUDNESS_CEILING = 1.08; // evolution may not make the whole mix more than ~0.7 dB louder

export const validMode = (mode) => (EVOLUTION_MODES.includes(mode) ? mode : 'gentle');
export const modeTiming = (mode) => MODES[mode] || null;

/** The environment's evolution profile, with defaults for anything it leaves out. */
export function profileOf(env) {
  const def = env?.evolution || {};
  const layers = {};
  for (const layer of env?.layers || []) {
    const d = def.layers?.[layer.id] || {};
    const [lo, hi] = Array.isArray(d.range) && d.range.length === 2 ? d.range : DEFAULT_RANGE;
    const low = Math.max(0, Math.min(lo, hi));
    const high = Math.min(1.4, Math.max(lo, hi));
    const start = Number.isFinite(d.start) ? Math.max(low, Math.min(high, d.start)) : 1;
    layers[layer.id] = { range: [low, high], start };
  }
  const params = Object.fromEntries(PARAM_NAMES.map((k) => [k, Math.max(0, Math.min(0.3, Number(def.params?.[k]) || 0.08))]));
  return { layers, params };
}

/** Where each layer's evolution gain opens (all 1 when evolution is off). */
export function startLevels(profile, mode) {
  return Object.fromEntries(Object.entries(profile.layers).map(([id, l]) => [id, mode === 'off' ? 1 : l.start]));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The next step: new targets for every layer's evolution gain, parameter offsets, whether to
 * make a harmonic change, the ramp time constant and the wait to the step after.
 *
 * @param {object} o
 * @param {ReturnType<typeof profileOf>} o.profile
 * @param {string} o.mode           'gentle' | 'dynamic' | 'organic'
 * @param {() => number} o.rng
 * @param {Record<string, number>} o.current  the layers' evolution gains now
 * @param {Record<string, number>} o.levels   the layers' mix levels (× scale), for the loudness guard
 */
export function evolutionStep({ profile, mode, rng, current, levels = {} }) {
  const m = MODES[mode];
  if (!m) return null;
  const targets = {};
  for (const [id, { range: [lo, hi] }] of Object.entries(profile.layers)) {
    const now = current[id] ?? 1;
    if (m.keep && rng() < m.keep) {
      targets[id] = now;
      continue;
    }
    let raw;
    const roll = rng();
    if (mode === 'organic' && roll < 0.12) raw = lo; // a layer rests for a while
    else if (mode === 'organic' && roll < 0.24) raw = hi; // or blooms
    else raw = lo + (hi - lo) * rng();
    // Pulled towards 1 by `reach`, and never more than `step` from where it is.
    const wanted = 1 + (raw - 1) * m.reach;
    targets[id] = clamp(now + clamp(wanted - now, -m.step, m.step), lo, hi);
  }

  // Loudness guard: the mix as a whole stays where the user put it.
  let base = 0;
  let evolved = 0;
  for (const [id, t] of Object.entries(targets)) {
    const level = levels[id] ?? 1;
    base += level;
    evolved += level * t;
  }
  if (base > 0 && evolved / base > LOUDNESS_CEILING) {
    const k = (LOUDNESS_CEILING * base) / evolved;
    for (const id of Object.keys(targets)) targets[id] = Math.max(profile.layers[id].range[0], targets[id] * k);
  }

  const offsets = Object.fromEntries(PARAM_NAMES.map((k) => [
    k,
    mode === 'organic' && rng() < 0.3 ? 0 : (rng() * 2 - 1) * profile.params[k] * m.params,
  ]));

  return {
    targets,
    offsets,
    harmonic: rng() < m.harmonic,
    tc: range(rng, m.tc[0], m.tc[1]),
    wait: range(rng, m.wait[0], m.wait[1]),
  };
}

/** The first step's delay for `mode` (seconds). */
export const firstWait = (mode, rng) => {
  const m = MODES[mode];
  return m ? range(rng, m.first[0], m.first[1]) : Infinity;
};

/** The user's parameters with the evolution's offsets, kept in 0–1. */
export function effectiveParams(params, offsets) {
  if (!offsets) return params;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, clamp(v + (offsets[k] || 0), 0, 1)]));
}
