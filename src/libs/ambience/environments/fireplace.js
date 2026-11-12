// Fireplace: a warm low roar, crackles and the odd pop, a soft hiss of embers, and the low
// warmth of the room.
import { glide } from '../voices.js';
import { range } from '../random.js';

export default {
  id: 'fireplace',
  name: 'Fireplace',
  subtitle: 'A warm fire, crackling softly',
  palette: ['#d9632b', '#f2b84b'],
  accent: '#d8a46e', // warm amber
  glow: ['#eeb45a', '#df8550', '#ee9f86'],
  layers: [
    { id: 'fire', label: 'Fire', level: 0.55, scale: 0.8, space: { pos: 0, drift: 0.12 } },
    { id: 'crackle', label: 'Crackle', level: 0.5, scale: 0.8, space: { pos: 0, spread: 0.55 } },
    { id: 'embers', label: 'Embers', level: 0.2, scale: 0.4, space: { pos: 0.1, drift: 0.3 } },
    { id: 'room', label: 'Room', level: 0.3, scale: 0.6, space: { pos: 0 } },
  ],
  evolution: {
    layers: {
      fire: { range: [0.82, 1.1] },
      crackle: { range: [0.5, 1.15] },
      embers: { range: [0.4, 1.3] },
      room: { range: [0.8, 1.1] },
    },
    params: { mood: 0.14, variation: 0.1, depth: 0.05 },
  },

  create(kit, { params }) {
    const { ctx, rng } = kit;
    const levels = {};

    const fire = kit.layer(0, { reverb: 0.15 });
    levels.fire = fire.gain;
    const roarLp = kit.filter('lowpass', 380, 0.6);
    const roar = kit.gain(0.55);
    kit.loop('brown').connect(roarLp).connect(roar).connect(fire.gain);
    const flicker = kit.lfo(roar.gain, 0.3, 0.12);
    kit.lfo(roarLp.frequency, 0.11, 90);

    const crackle = kit.layer(0, { reverb: 0.12 });
    levels.crackle = crackle.gain;

    const embers = kit.layer(0, { reverb: 0.1 });
    levels.embers = embers.gain;
    const hiss = kit.filter('highpass', 4500, 0.5);
    const hissGain = kit.gain(0.3);
    kit.loop('pink').connect(hiss).connect(hissGain).connect(embers.gain);
    kit.lfo(hissGain.gain, 0.17, 0.1);

    const room = kit.layer(0, { reverb: 0.2 });
    levels.room = room.gain;
    const roomLp = kit.filter('lowpass', 130, 0.5);
    kit.loop('brown', { rate: 0.75 }).connect(roomLp).connect(room.gain);

    let p = params;
    let nextCrackle = 0;
    let pitch = 1;

    const apply = (next) => {
      p = next;
      glide(roarLp.frequency, 460 - p.depth * 200, ctx, 1.5);
      glide(flicker.depth.gain, 0.05 + p.variation * 0.16, ctx, 2);
    };
    apply(params);

    const schedule = (from, to) => {
      const perSecond = 2 + p.mood * 8;
      let t = Math.max(nextCrackle, from);
      let made = 0;
      while (t < to && made < 40) {
        const pop = rng() < 0.08;
        kit.burst(t, {
          type: 'white', dest: crackle.gain, filterType: pop ? 'bandpass' : 'highpass',
          frequency: (pop ? range(rng, 500, 1100) : range(rng, 1500, 4500)) * pitch, Q: pop ? 1.4 : 0.8,
          level: pop ? range(rng, 0.25, 0.4) : range(rng, 0.05, 0.18), attack: 0.001, decay: pop ? range(rng, 0.03, 0.07) : range(rng, 0.004, 0.02),
        });
        made += 1;
        // Crackles come in little clusters.
        t += rng() < 0.3 ? range(rng, 0.01, 0.05) : -Math.log(1 - rng()) / perSecond;
      }
      nextCrackle = t;
    };

    const randomize = (r) => {
      pitch = range(r, 0.8, 1.2);
      glide(hiss.frequency, range(r, 3800, 5600), ctx, 3);
    };

    // Living Atmosphere: the fire settles or catches (the crackles' pitch, the roar's colour).
    const evolve = (r) => {
      pitch = Math.max(0.8, Math.min(1.2, pitch + range(r, -0.08, 0.08)));
      glide(hiss.frequency, range(r, 3800, 5600), ctx, 15);
    };

    return { levels, apply, schedule, randomize, evolve };
  },
};
