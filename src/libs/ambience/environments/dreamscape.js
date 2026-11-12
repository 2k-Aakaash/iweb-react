// Dreamscape: slow piano-like notes over soft pads, a high shimmer through the delay, and
// a breath of air.
import { glide } from '../voices.js';
import { SCALES, melodicNote, mtof, range, scaleNotes, weighted } from '../random.js';

export default {
  id: 'dreamscape',
  name: 'Dreamscape',
  subtitle: 'Slow piano, soft pads, shimmering air',
  palette: ['#b16cea', '#ff8ac2'],
  accent: '#bca6e0', // lavender, soft pink
  glow: ['#b39cf5', '#f2a0cc', '#93b4f2'],
  layers: [
    { id: 'piano', label: 'Piano', level: 0.5, scale: 0.8, space: { pos: 0, spread: 0.35 } },
    { id: 'pads', label: 'Pads', level: 0.4, scale: 0.8, space: { pos: 0, spread: 0.7 } },
    { id: 'shimmer', label: 'Shimmer', level: 0.25, scale: 0.6, space: { pos: 0.2, drift: 0.8, spread: 0.6 } },
    { id: 'air', label: 'Air', level: 0.2, scale: 0.4, space: { pos: 0, drift: 0.5 } },
  ],
  // It opens on pads and air; the piano arrives over the first minutes, the shimmer grows,
  // and later the piano thins out again while the pads change.
  evolution: {
    layers: {
      piano: { range: [0.15, 1.15], start: 0.15 },
      pads: { range: [0.6, 1.15] },
      shimmer: { range: [0.3, 1.3], start: 0.35 },
      air: { range: [0.5, 1.2] },
    },
    params: { mood: 0.12, variation: 0.12, depth: 0.08 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};
    let key = { root: 60, scale: SCALES.lydian };

    const piano = kit.layer(0, { reverb: 0.55, delay: 0.15 });
    levels.piano = piano.gain;
    const pads = kit.layer(0, { reverb: 0.6 });
    levels.pads = pads.gain;
    const shimmer = kit.layer(0, { reverb: 0.6, delay: 0.45 });
    levels.shimmer = shimmer.gain;

    const air = kit.layer(0, { reverb: 0.3 });
    levels.air = air.gain;
    const airBand = kit.filter('bandpass', 900, 0.6);
    const airGain = kit.gain(0.4);
    kit.loop('pink').connect(airBand).connect(airGain).connect(air.gain);
    const airSweep = kit.lfo(airBand.frequency, 0.02, 400);
    kit.lfo(airGain.gain, 0.04, 0.15);

    let p = params;
    let notes = scaleNotes(key.root, key.scale, 60, 84);
    let prev = null;
    let nextNote = 0;
    let nextPad = 0;
    let nextSparkle = 0;

    const apply = (next) => {
      p = next;
      glide(piano.reverb.gain, 0.4 + p.depth * 0.4, ctx, 1.5);
      glide(pads.reverb.gain, 0.45 + p.depth * 0.35, ctx, 1.5);
      glide(airSweep.depth.gain, 150 + p.variation * 600, ctx, 2);
    };
    apply(params);

    const schedule = (from, to) => {
      if (nextNote === 0) nextNote = from + range(rng, 1, 3);
      while (nextNote < to) {
        const n = melodicNote(rng, notes, prev);
        prev = n;
        kit.tone(nextNote, mtof(n), { dest: piano.gain, level: range(rng, 0.13, 0.2), decay: range(rng, 5, 8), bright: 2000 });
        nextNote += range(rng, 2.2, 6.5) / (0.6 + p.mood * 0.9);
      }
      if (nextPad === 0) nextPad = from + 0.3;
      while (nextPad < to) {
        const length = range(rng, 18, 30) / (0.7 + p.variation * 0.6);
        const base = key.root - 12;
        const chord = weighted(rng, [[0, 4, 7, 11], [2, 7, 9, 14], [-3, 4, 7, 12], [5, 9, 12, 16]], [3, 2, 2, 2]);
        kit.pad(nextPad, chord.map((s) => mtof(base + s)), { dest: pads.gain, level: 0.045, attack: 6, hold: length * 0.6, release: 9, cutoff: 900 + p.mood * 700 });
        nextPad += length;
      }
      if (nextSparkle === 0) nextSparkle = from + range(rng, 3, 7);
      while (nextSparkle < to) {
        kit.tone(nextSparkle, mtof(melodicNote(rng, notes, prev) + 24), { dest: shimmer.gain, kind: 'bell', level: 0.04, decay: 3.5, bright: 7000 });
        nextSparkle += range(rng, 4, 11);
      }
    };

    const randomize = (r) => {
      key = weighted(r, [
        { root: 60, scale: SCALES.lydian },
        { root: 62, scale: SCALES.majorPentatonic },
        { root: 57, scale: SCALES.aeolian },
        { root: 65, scale: SCALES.lydian },
      ], [3, 2, 2, 1]);
      notes = scaleNotes(key.root, key.scale, 60, 84);
      prev = null;
      glide(airBand.frequency, range(r, 700, 1200), ctx, 4);
    };

    // Living Atmosphere: the harmony moves to a closely related key (sharing most notes) and
    // the piano changes register; the air turns slowly.
    const evolve = (r) => {
      const related = {
        60: [{ root: 67, scale: SCALES.majorPentatonic }, { root: 57, scale: SCALES.aeolian }],
        62: [{ root: 60, scale: SCALES.lydian }, { root: 57, scale: SCALES.aeolian }],
        57: [{ root: 60, scale: SCALES.lydian }, { root: 62, scale: SCALES.majorPentatonic }],
        65: [{ root: 60, scale: SCALES.lydian }],
        67: [{ root: 60, scale: SCALES.lydian }, { root: 62, scale: SCALES.majorPentatonic }],
      }[key.root] || [{ root: 60, scale: SCALES.lydian }];
      if (r() < 0.5) key = related[Math.floor(r() * related.length)];
      const low = weighted(r, [57, 60, 64], [1, 3, 1]);
      notes = scaleNotes(key.root, key.scale, low, low + 24);
      prev = null;
      glide(airBand.frequency, range(r, 700, 1200), ctx, 15);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
