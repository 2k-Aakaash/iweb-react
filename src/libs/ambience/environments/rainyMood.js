// Rainy Mood: continuous rain (a hiss and a body, with drops on top), a light wind, a low
// atmosphere with distant thunder now and then, and sparse soft piano.
import { glide } from '../voices.js';
import { SCALES, melodicNote, mtof, range, scaleNotes, weighted } from '../random.js';

export default {
  id: 'rainy-mood',
  name: 'Rainy Mood',
  subtitle: 'Soft rain, distant thunder, a few piano notes',
  palette: ['#5b8cff', '#8a7dff'],
  accent: '#86b4dc', // cool blue, cyan
  glow: ['#62c6ee', '#6f8cf2', '#8f9cf0'],
  // space: where a layer sits (pos), how far it drifts (drift) and how widely its events
  // spread (spread) in the stereo field; see voices.js.
  layers: [
    { id: 'rain', label: 'Rain', level: 0.75, scale: 0.9, space: { pos: 0, spread: 0.85 } },
    { id: 'wind', label: 'Wind', level: 0.25, scale: 0.6, space: { pos: -0.25, drift: 0.65 } },
    { id: 'thunder', label: 'Thunder', level: 0.35, scale: 0.9, space: { pos: 0.2, drift: 0.25, spread: 0.5 } },
    { id: 'piano', label: 'Piano', level: 0.4, scale: 0.8, space: { pos: 0.05, spread: 0.2 } },
  ],
  // Rain stays the foundation; the wind rises and falls; thunder and piano come and go.
  evolution: {
    layers: {
      rain: { range: [0.84, 1.08] },
      wind: { range: [0.35, 1.3] },
      thunder: { range: [0.3, 1.15] },
      piano: { range: [0.2, 1.15], start: 0.6 },
    },
    params: { mood: 0.12, variation: 0.1, depth: 0.07 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};

    // Rain: a bright hiss and a darker body, both slowly breathing.
    const rain = kit.layer(0, { reverb: 0.12 });
    levels.rain = rain.gain;
    const hissHp = kit.filter('highpass', 600, 0.5);
    const hissLp = kit.filter('lowpass', 7000, 0.4);
    const hissGain = kit.gain(0.45);
    kit.loop('pink').connect(hissHp).connect(hissLp).connect(hissGain).connect(rain.gain);
    const hissLfo = kit.lfo(hissGain.gain, 0.07, 0.08);
    const body = kit.filter('lowpass', 900, 0.5);
    const bodyGain = kit.gain(0.32);
    kit.loop('brown', { rate: 0.97 }).connect(body).connect(bodyGain).connect(rain.gain);
    kit.lfo(bodyGain.gain, 0.045, 0.06);

    // Wind: brown noise through a wandering band-pass.
    const wind = kit.layer(0, { reverb: 0.2 });
    levels.wind = wind.gain;
    const windBand = kit.filter('bandpass', 480, 0.9);
    const windGain = kit.gain(0.55);
    kit.loop('brown', { rate: 1.03 }).connect(windBand).connect(windGain).connect(wind.gain);
    const windSweep = kit.lfo(windBand.frequency, 0.04, 220);
    kit.lfo(windGain.gain, 0.06, 0.2);

    // Thunder: a low bed, with rare distant rolls (scheduled).
    const thunder = kit.layer(0, { reverb: 0.35 });
    levels.thunder = thunder.gain;
    const bed = kit.filter('lowpass', 110, 0.6);
    const bedGain = kit.gain(0.35);
    kit.loop('brown', { rate: 0.8 }).connect(bed).connect(bedGain).connect(thunder.gain);

    // Piano: sparse notes from a pentatonic scale.
    const piano = kit.layer(0, { reverb: 0.5, delay: 0.12 });
    levels.piano = piano.gain;

    let key = { root: 57, scale: SCALES.minorPentatonic }; // A minor pentatonic
    let notes = scaleNotes(key.root, key.scale, 57, 81);
    let prev = null;
    let p = params;
    let nextDrop = 0;
    let nextNote = 0;
    let nextThunder = 0;

    const apply = (next) => {
      p = next;
      // Depth: a darker hiss, more body and space.
      glide(hissLp.frequency, 8500 - p.depth * 4500, ctx, 1.2);
      glide(bodyGain.gain, 0.24 + p.depth * 0.22, ctx, 1.2);
      glide(piano.reverb.gain, 0.35 + p.depth * 0.35, ctx, 1.5);
      glide(thunder.reverb.gain, 0.25 + p.depth * 0.3, ctx, 1.5);
      // Variation: how much the rain and wind move.
      glide(hissLfo.depth.gain, 0.03 + p.variation * 0.12, ctx, 2);
      glide(windSweep.depth.gain, 120 + p.variation * 260, ctx, 2);
    };
    apply(params);

    const schedule = (from, to) => {
      // Drops: a few to a dozen a second, by mood; a raindrop is a tiny bright click.
      const perSecond = 3 + p.mood * 9;
      let t = Math.max(nextDrop, from);
      let made = 0;
      while (t < to && made < 40) {
        kit.burst(t, {
          type: 'white', dest: rain.gain, frequency: range(rng, 2500, 7000), Q: range(rng, 1.5, 4),
          level: range(rng, 0.05, 0.16), attack: 0.001, decay: range(rng, 0.008, 0.03),
        });
        made += 1;
        t += (-Math.log(1 - rng()) / perSecond); // random gaps, like real drops
      }
      nextDrop = t;

      // Piano: one note (sometimes two) every few seconds; calmer moods are sparser.
      if (nextNote === 0) nextNote = from + range(rng, 2, 5);
      while (nextNote < to) {
        const n = melodicNote(rng, notes, prev);
        prev = n;
        kit.tone(nextNote, mtof(n), { dest: piano.gain, level: range(rng, 0.14, 0.22), decay: range(rng, 3.5, 6) });
        if (rng() < 0.25) {
          const pair = notes[Math.max(0, notes.indexOf(n) - 2)];
          kit.tone(nextNote + range(rng, 0.25, 0.6), mtof(pair), { dest: piano.gain, level: 0.11, decay: 5 });
        }
        nextNote += range(rng, 3.5, 11) / (0.7 + p.mood * 0.8);
      }

      // Thunder: a distant roll every minute or two; more variation, more often.
      if (nextThunder === 0) nextThunder = from + range(rng, 25, 60);
      if (nextThunder < to) {
        kit.burst(nextThunder, {
          type: 'brown', dest: thunder.gain, filterType: 'lowpass', frequency: range(rng, 90, 150), Q: 0.6,
          level: range(rng, 0.5, 0.85), attack: range(rng, 0.8, 1.8), decay: range(rng, 5, 8), sweepTo: 60,
        });
        nextThunder += range(rng, 55, 140) / (0.6 + p.variation * 0.8);
      }
    };

    const randomize = (r) => {
      key = weighted(r, [
        { root: 57, scale: SCALES.minorPentatonic },
        { root: 62, scale: SCALES.minorPentatonic },
        { root: 55, scale: SCALES.majorPentatonic },
        { root: 60, scale: SCALES.majorPentatonic },
        { root: 52, scale: SCALES.minorPentatonic },
      ], [3, 2, 2, 2, 1]);
      notes = scaleNotes(key.root, key.scale, 55, 81);
      prev = null;
      glide(hissHp.frequency, range(r, 450, 800), ctx, 3);
      glide(windBand.frequency, range(r, 360, 620), ctx, 4);
      glide(body.frequency, range(r, 700, 1100), ctx, 3);
    };

    // Living Atmosphere: the piano moves register in the same key, the wind finds a new
    // colour and the rain's brightness shifts, all over tens of seconds.
    const evolve = (r) => {
      const low = weighted(r, [52, 55, 57, 60], [1, 2, 3, 2]);
      notes = scaleNotes(key.root, key.scale, low, low + 24);
      glide(windBand.frequency, range(r, 360, 620), ctx, 12);
      glide(hissHp.frequency, range(r, 480, 760), ctx, 15);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
