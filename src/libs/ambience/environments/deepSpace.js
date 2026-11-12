// Deep Space: a slow, deep drone, soft evolving pads, a faint high shimmer and sparse bell
// notes from a calm mode.
import { glide } from '../voices.js';
import { SCALES, melodicNote, mtof, range, scaleNotes, weighted } from '../random.js';

// Chord progressions as scale degrees (0-based) for a seven-note mode.
const PROGRESSIONS = [
  [0, 6, 3, 4],
  [0, 3, 5, 4],
  [0, 5, 3, 6],
  [0, 2, 3, 0],
];

export default {
  id: 'deep-space',
  name: 'Deep Space',
  subtitle: 'A slow drone, soft pads, far-off bells',
  palette: ['#3b2a8f', '#16a3d6'],
  accent: '#8a86d6', // deep blue, violet
  glow: ['#4f63d6', '#7a62e8', '#4aa6d8'],
  layers: [
    { id: 'drone', label: 'Drone', level: 0.6, scale: 0.8, space: { pos: 0 } },
    { id: 'pads', label: 'Pads', level: 0.45, scale: 0.9, space: { pos: 0, spread: 0.7 } },
    { id: 'texture', label: 'Shimmer', level: 0.2, scale: 0.5, space: { pos: 0.25, drift: 0.9, spread: 0.6 } },
    { id: 'melody', label: 'Bells', level: 0.3, scale: 0.7, space: { pos: -0.1, spread: 0.55 } },
  ],
  // The drone holds; pads change colour; the shimmer drifts in and out; bells are occasional.
  evolution: {
    layers: {
      drone: { range: [0.86, 1.05] },
      pads: { range: [0.55, 1.15] },
      texture: { range: [0.2, 1.25], start: 0.45 },
      melody: { range: [0.25, 1.15], start: 0.5 },
    },
    params: { mood: 0.1, variation: 0.12, depth: 0.08 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};
    let mode = { root: 50, scale: SCALES.dorian }; // D dorian
    let progression = PROGRESSIONS[0];

    // Drone: two slightly detuned saws under a slowly moving low-pass, and a sine an octave down.
    const drone = kit.layer(0, { reverb: 0.3 });
    levels.drone = drone.gain;
    const droneLp = kit.filter('lowpass', 220, 1.2);
    const sawGain = kit.gain(0.16);
    const sawA = kit.osc('sawtooth', mtof(mode.root - 12));
    const sawB = kit.osc('sawtooth', mtof(mode.root - 12), 7);
    sawA.connect(sawGain);
    sawB.connect(sawGain);
    sawGain.connect(droneLp).connect(drone.gain);
    const droneSweep = kit.lfo(droneLp.frequency, 0.025, 90);
    const subGain = kit.gain(0.35);
    const sub = kit.osc('sine', mtof(mode.root - 24));
    sub.connect(subGain).connect(drone.gain);

    // Pads: chords (scheduled) into one layer.
    const pads = kit.layer(0, { reverb: 0.55, delay: 0.08 });
    levels.pads = pads.gain;

    // Shimmer: a narrow band of high noise, breathing slowly; occasional faint pings.
    const texture = kit.layer(0, { reverb: 0.6, delay: 0.25 });
    levels.texture = texture.gain;
    const band = kit.filter('bandpass', 5200, 7);
    const shimmerGain = kit.gain(0.55);
    kit.loop('white').connect(band).connect(shimmerGain).connect(texture.gain);
    kit.lfo(shimmerGain.gain, 0.05, 0.35);
    const bandSweep = kit.lfo(band.frequency, 0.018, 1400);

    // Bells: sparse, high, through the delay.
    const melody = kit.layer(0, { reverb: 0.55, delay: 0.35 });
    levels.melody = melody.gain;

    let p = params;
    let nextChord = 0;
    let chordIndex = 0;
    let nextBell = 0;
    let nextPing = 0;
    let prev = null;
    let bellNotes = scaleNotes(mode.root, mode.scale, 74, 93);

    const chordAt = (degree) => {
      const s = mode.scale;
      const pick = (k) => {
        const d = degree + k;
        return mode.root + 12 + s[d % s.length] + 12 * Math.floor(d / s.length);
      };
      return [pick(0), pick(2), pick(4), pick(6) - 12].map(mtof);
    };

    const apply = (next) => {
      p = next;
      // Depth: a lower, fuller drone and more space.
      glide(droneLp.frequency, 320 - p.depth * 170, ctx, 2);
      glide(subGain.gain, 0.2 + p.depth * 0.3, ctx, 2);
      glide(pads.reverb.gain, 0.4 + p.depth * 0.35, ctx, 2);
      // Variation: how far the filters wander.
      glide(droneSweep.depth.gain, 40 + p.variation * 120, ctx, 3);
      glide(bandSweep.depth.gain, 500 + p.variation * 1800, ctx, 3);
    };
    apply(params);

    const schedule = (from, to) => {
      // A new chord every 16–32 s (sooner with more variation), overlapping the last.
      if (nextChord === 0) nextChord = from + 0.2;
      while (nextChord < to) {
        const length = range(rng, 16, 32) / (0.7 + p.variation * 0.7);
        const cutoff = 700 + p.mood * 900;
        kit.pad(nextChord, chordAt(progression[chordIndex % progression.length]), {
          dest: pads.gain, level: 0.05, attack: Math.min(7, length * 0.35), hold: length * 0.6, release: Math.min(9, length * 0.45), cutoff,
        });
        chordIndex += 1;
        nextChord += length;
      }
      // Bells: rare; a little less rare with an energetic mood.
      if (nextBell === 0) nextBell = from + range(rng, 6, 12);
      while (nextBell < to) {
        const n = melodicNote(rng, bellNotes, prev);
        prev = n;
        kit.tone(nextBell, mtof(n), { dest: melody.gain, kind: 'bell', level: range(rng, 0.06, 0.1), decay: range(rng, 5, 8), bright: 5000 });
        nextBell += range(rng, 7, 18) / (0.6 + p.mood * 0.9);
      }
      // Pings: very quiet, very high, now and then.
      if (nextPing === 0) nextPing = from + range(rng, 4, 9);
      while (nextPing < to) {
        kit.tone(nextPing, range(rng, 1800, 3600), { dest: texture.gain, kind: 'bell', level: 0.025, decay: 2.5, bright: 8000 });
        nextPing += range(rng, 5, 14);
      }
    };

    const randomize = (r) => {
      mode = weighted(r, [
        { root: 50, scale: SCALES.dorian },
        { root: 45, scale: SCALES.aeolian },
        { root: 48, scale: SCALES.lydian },
        { root: 52, scale: SCALES.dorian },
        { root: 43, scale: SCALES.aeolian },
      ], [3, 2, 2, 2, 1]);
      progression = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
      chordIndex = 0;
      bellNotes = scaleNotes(mode.root, mode.scale, 74, 93);
      prev = null;
      // The drone glides to the new root over a few seconds.
      glide(sawA.frequency, mtof(mode.root - 12), ctx, 2.5);
      glide(sawB.frequency, mtof(mode.root - 12), ctx, 2.5);
      glide(sub.frequency, mtof(mode.root - 24), ctx, 2.5);
      glide(band.frequency, range(r, 4200, 6400), ctx, 4);
    };

    // Living Atmosphere: the pads take a new progression, sometimes in a neighbouring mode on
    // the same root (dorian ↔ aeolian): a change of colour, never of key. The drone stays.
    const evolve = (r) => {
      progression = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
      chordIndex = 0;
      if (r() < 0.35) {
        const next = mode.scale === SCALES.dorian ? SCALES.aeolian : mode.scale === SCALES.aeolian ? SCALES.dorian : mode.scale;
        mode = { root: mode.root, scale: next };
        bellNotes = scaleNotes(mode.root, mode.scale, 74, 93);
        prev = null;
      }
      glide(band.frequency, range(r, 4200, 6400), ctx, 20);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
