// A small seeded random source (mulberry32) for the ambience engine, so a preset's seed gives
// the same arrangement again (not the same waveform: timing still follows the audio clock).

/** @returns {() => number} a function giving numbers in [0, 1) */
export function seeded(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/** A number between `min` and `max`. */
export const range = (rng, min, max) => min + (max - min) * rng();

/** One of `items`, by `weights` (same length; any positive numbers). */
export function weighted(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** MIDI note number to frequency (A4 = 69 = 440 Hz). */
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** The notes of `scale` (semitone steps from the root) from `low` to `high` (MIDI). */
export function scaleNotes(root, scale, low, high) {
  const out = [];
  for (let octave = -2; octave < 9; octave += 1) {
    for (const step of scale) {
      const n = root + octave * 12 + step;
      if (n >= low && n <= high) out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * A note from `notes`, favouring the middle of the range and small steps from `prev`, so a
 * random line still sounds like a melody rather than a scatter.
 */
export function melodicNote(rng, notes, prev = null) {
  if (!notes.length) return null;
  const mid = (notes.length - 1) / 2;
  const weights = notes.map((n, i) => {
    const centre = 1 / (1 + ((i - mid) / Math.max(1, mid)) ** 2 * 2);
    const step = prev === null ? 1 : 1 / (1 + Math.abs(n - prev) / 4);
    return centre * step;
  });
  return weighted(rng, notes, weights);
}

export const SCALES = Object.freeze({
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
});
