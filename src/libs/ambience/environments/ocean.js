// Ocean: overlapping waves (each a slow swell of filtered noise), foam at the crests, sea
// wind and a deep low body.
import { glide } from '../voices.js';
import { range } from '../random.js';

export default {
  id: 'ocean',
  name: 'Ocean',
  subtitle: 'Rolling waves, foam and sea wind',
  palette: ['#1f6fb2', '#3fc6c9'],
  accent: '#72c0c0', // teal, turquoise
  glow: ['#45c2c4', '#4b93cf', '#7fd3c4'],
  layers: [
    { id: 'waves', label: 'Waves', level: 0.7, scale: 0.9, space: { pos: 0, drift: 0.3, spread: 0.45 } },
    { id: 'foam', label: 'Foam', level: 0.35, scale: 0.6, space: { pos: 0, spread: 0.65 } },
    { id: 'wind', label: 'Wind', level: 0.25, scale: 0.5, space: { pos: -0.2, drift: 0.6 } },
    { id: 'deep', label: 'Deep', level: 0.35, scale: 0.7, space: { pos: 0 } },
  ],
  evolution: {
    layers: {
      waves: { range: [0.85, 1.08] },
      foam: { range: [0.5, 1.2] },
      wind: { range: [0.35, 1.3] },
      deep: { range: [0.7, 1.12] },
    },
    params: { mood: 0.12, variation: 0.1, depth: 0.08 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};

    const waves = kit.layer(0, { reverb: 0.25 });
    levels.waves = waves.gain;
    // A quiet constant wash under the scheduled waves, so there are never silent gaps.
    const washLp = kit.filter('lowpass', 420, 0.5);
    const wash = kit.gain(0.22);
    kit.loop('brown').connect(washLp).connect(wash).connect(waves.gain);
    kit.lfo(wash.gain, 0.08, 0.08);

    const foam = kit.layer(0, { reverb: 0.2 });
    levels.foam = foam.gain;

    const wind = kit.layer(0, { reverb: 0.2 });
    levels.wind = wind.gain;
    const windBand = kit.filter('bandpass', 650, 0.7);
    kit.loop('pink', { rate: 0.95 }).connect(windBand).connect(wind.gain);
    const windSweep = kit.lfo(windBand.frequency, 0.03, 250);

    const deep = kit.layer(0, { reverb: 0.3 });
    levels.deep = deep.gain;
    const deepLp = kit.filter('lowpass', 80, 0.7);
    const deepGain = kit.gain(0.6);
    kit.loop('brown', { rate: 0.7 }).connect(deepLp).connect(deepGain).connect(deep.gain);
    kit.lfo(deepGain.gain, 0.06, 0.2);

    let p = params;
    let nextWave = 0;
    let period = 9;

    const apply = (next) => {
      p = next;
      glide(washLp.frequency, 520 - p.depth * 220, ctx, 1.5);
      glide(deepGain.gain, 0.4 + p.depth * 0.4, ctx, 1.5);
      glide(windSweep.depth.gain, 120 + p.variation * 300, ctx, 2);
    };
    apply(params);

    const schedule = (from, to) => {
      if (nextWave === 0) nextWave = from + 0.3;
      while (nextWave < to) {
        const rise = range(rng, 2.4, 3.6);
        const fall = range(rng, 4, 6.5);
        const size = range(rng, 0.45, 0.8);
        // The wave: brown noise opening up as it rises, closing as it falls back.
        kit.burst(nextWave, {
          type: 'brown', dest: waves.gain, filterType: 'lowpass', frequency: 300, Q: 0.4,
          level: size, attack: rise, decay: fall, sweepTo: 1100 + p.mood * 600,
        });
        // Foam at the crest.
        kit.burst(nextWave + rise * 0.7, {
          type: 'pink', dest: foam.gain, filterType: 'highpass', frequency: 1500, Q: 0.5,
          level: size * 0.6, attack: rise * 0.4, decay: fall * 0.5,
        });
        const spread = 0.25 + p.variation * 0.5;
        nextWave += period * range(rng, 1 - spread, 1 + spread) / (0.75 + p.mood * 0.5);
      }
    };

    const randomize = (r) => {
      period = range(r, 7, 12);
      glide(windBand.frequency, range(r, 500, 800), ctx, 4);
    };

    // Living Atmosphere: the swell's rhythm slowly changes (a few seconds either way).
    const evolve = (r) => {
      period = Math.max(7, Math.min(12, period + range(r, -1.5, 1.5)));
      glide(windBand.frequency, range(r, 500, 800), ctx, 15);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
