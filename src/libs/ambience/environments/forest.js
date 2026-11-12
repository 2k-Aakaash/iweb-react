// Forest: wind in the trees, rustling leaves, a nearby brook, and now and then a bird-like
// phrase (synthesized chirps, no recordings).
import { glide } from '../voices.js';
import { range, weighted } from '../random.js';

// Phrase shapes: [count range, base frequency range, gap range, rise].
const SONGS = [
  { count: [2, 4], freq: [2600, 3400], gap: [0.12, 0.2], rise: 1.3 },
  { count: [3, 6], freq: [3600, 4600], gap: [0.07, 0.12], rise: 1.15 },
  { count: [1, 2], freq: [1900, 2500], gap: [0.3, 0.5], rise: 1.5 },
];

export default {
  id: 'forest',
  name: 'Forest',
  subtitle: 'Wind, leaves, a brook and birds',
  palette: ['#2f8f5b', '#a6c95a'],
  accent: '#93b98c', // muted green
  glow: ['#6fbf8e', '#a3c47c', '#5fae9f'],
  layers: [
    { id: 'wind', label: 'Wind', level: 0.4, scale: 0.6, space: { pos: 0, drift: 0.7 } },
    { id: 'leaves', label: 'Leaves', level: 0.35, scale: 0.45, space: { pos: 0.15, drift: 0.4 } },
    { id: 'brook', label: 'Brook', level: 0.35, scale: 0.55, space: { pos: -0.45, drift: 0.1 } },
    { id: 'birds', label: 'Birds', level: 0.35, scale: 0.8, space: { pos: 0.05, spread: 0.9 } },
  ],
  evolution: {
    layers: {
      wind: { range: [0.45, 1.25] },
      leaves: { range: [0.5, 1.2] },
      brook: { range: [0.72, 1.1] },
      birds: { range: [0.25, 1.2] },
    },
    params: { mood: 0.15, variation: 0.1, depth: 0.06 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};

    const wind = kit.layer(0, { reverb: 0.25 });
    levels.wind = wind.gain;
    const windBand = kit.filter('bandpass', 420, 0.8);
    const windGain = kit.gain(0.6);
    kit.loop('brown').connect(windBand).connect(windGain).connect(wind.gain);
    const windSweep = kit.lfo(windBand.frequency, 0.035, 180);
    kit.lfo(windGain.gain, 0.05, 0.25);

    const leaves = kit.layer(0, { reverb: 0.15 });
    levels.leaves = leaves.gain;
    const leafHp = kit.filter('highpass', 2200, 0.5);
    const leafGain = kit.gain(0.35);
    kit.loop('pink', { rate: 1.1 }).connect(leafHp).connect(leafGain).connect(leaves.gain);
    const rustle = kit.lfo(leafGain.gain, 0.21, 0.18);

    const brook = kit.layer(0, { reverb: 0.2 });
    levels.brook = brook.gain;
    const low = kit.filter('bandpass', 1100, 0.7);
    const high = kit.filter('bandpass', 2600, 1.2);
    const babble = kit.gain(0.45);
    const src = kit.loop('white', { rate: 0.9 });
    src.connect(low).connect(babble);
    src.connect(high).connect(babble);
    babble.connect(brook.gain);
    kit.lfo(babble.gain, 4.3, 0.12);
    kit.lfo(low.frequency, 0.6, 180);

    const birds = kit.layer(0, { reverb: 0.4, delay: 0.1 });
    levels.birds = birds.gain;

    let p = params;
    let nextPhrase = 0;
    let songs = SONGS;

    const apply = (next) => {
      p = next;
      glide(leafHp.frequency, 2600 - p.depth * 1200, ctx, 1.5);
      glide(birds.reverb.gain, 0.25 + p.depth * 0.35, ctx, 1.5);
      glide(windSweep.depth.gain, 80 + p.variation * 220, ctx, 2);
      glide(rustle.depth.gain, 0.08 + p.variation * 0.18, ctx, 2);
    };
    apply(params);

    const schedule = (from, to) => {
      if (nextPhrase === 0) nextPhrase = from + range(rng, 2, 6);
      while (nextPhrase < to) {
        const song = weighted(rng, songs, [3, 2, 1].slice(0, songs.length));
        const count = Math.round(range(rng, song.count[0], song.count[1]));
        const base = range(rng, song.freq[0], song.freq[1]);
        let t = nextPhrase;
        for (let i = 0; i < count; i += 1) {
          kit.chirp(t, base * range(rng, 0.94, 1.08), { dest: birds.gain, level: range(rng, 0.03, 0.06), length: range(rng, 0.06, 0.12), rise: song.rise });
          t += range(rng, song.gap[0], song.gap[1]);
        }
        nextPhrase += range(rng, 4, 13) / (0.6 + p.mood * 0.9);
      }
    };

    const randomize = (r) => {
      songs = [...SONGS].sort(() => r() - 0.5);
      glide(windBand.frequency, range(r, 340, 520), ctx, 4);
      glide(high.frequency, range(r, 2200, 3000), ctx, 3);
    };

    // Living Atmosphere: different birds take over; the wind turns.
    const evolve = (r) => {
      songs = [...SONGS].sort(() => r() - 0.5);
      glide(windBand.frequency, range(r, 340, 520), ctx, 15);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
