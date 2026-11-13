// The Frontier world clock: how the hour and the weather move by themselves. Pure functions
// (the engine runs them on its existing ticker, only while playing), so the behaviour is
// deterministic from a seed and testable without audio.
//
//   time      'fixed'        the chosen hour (or the place's own), held
//             'local'        follows this device's clock
//             'accelerated'  a simulated clock running `speed` simulated minutes per real minute
//   weather   'locked'       the chosen weather (or the place's own), held
//             'simulated'    lasts at least the destination's dwell time, then moves to a
//                            neighbouring weather by the destination's weights. Rainier weather
//                            arrives as a front: announced (a gust, distant thunder) a few
//                            simulated minutes before it starts.
//
// Weather time runs at `speed` with the accelerated clock and in real time otherwise, so a
// held or real-time hour still has weather that changes on a believable scale (an hour or so).
import { range, weighted } from '../random.js';
import { NEIGHBOURS, TIME_IDS, weatherFor } from './conditions.js';

const DAY = 1440;

// When each phase starts (minute of the day) and where a chosen phase is placed.
const PHASES = [
  { id: 'night', from: 0 },
  { id: 'dawn', from: 300 },
  { id: 'morning', from: 450 },
  { id: 'afternoon', from: 720 },
  { id: 'dusk', from: 1020 },
  { id: 'night', from: 1200 },
];
const MIDDLE = { dawn: 375, morning: 585, afternoon: 870, dusk: 1110, night: 1380 };
const SPAN = { dawn: [300, 450], morning: [450, 720], afternoon: [720, 1020], dusk: [1020, 1200], night: [1200, 1740] };

/** The phase at a minute of the day. */
export function phaseAt(minutes) {
  const m = ((minutes % DAY) + DAY) % DAY;
  let id = 'night';
  for (const p of PHASES) if (m >= p.from) ({ id } = p);
  return id;
}

/** How far through its phase a minute is (0–1): dawn's chorus builds, dusk's crickets join. */
export function phaseProgress(minutes) {
  const m = ((minutes % DAY) + DAY) % DAY;
  const id = phaseAt(m);
  const [a, b] = SPAN[id];
  const at = id === 'night' && m < 300 ? m + DAY : m;
  return Math.min(1, Math.max(0, (at - a) / (b - a)));
}

/** A representative minute for a phase (where a chosen hour starts the clock). */
export const phaseMiddle = (id) => MIDDLE[id] ?? MIDDLE.afternoon;

/** The device's minute of the day. */
export const localMinutes = (date) => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

/** "6:42": a clock time for a minute of the day. */
export function clockLabel(minutes) {
  const m = Math.floor(((minutes % DAY) + DAY) % DAY);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const RAINIER = ['light-rain', 'heavy-rain', 'thunderstorm', 'snowfall'];

/** The next weather after `current` in a destination: a neighbour, by weight (or the same). */
export function nextWeather(current, weather, rng) {
  const options = (NEIGHBOURS[current] || []).filter((w) => weather.allowed.includes(w));
  const stay = weather.weights[current] ?? 1;
  const all = [current, ...options];
  // Staying counts for its own weight: settled weather tends to stay settled.
  const weights = all.map((w, i) => (i === 0 ? stay * 1.2 : (weather.weights[w] ?? 1) * (RAINIER.includes(w) && !RAINIER.includes(current) ? 0.8 : 1)));
  return weighted(rng, all, weights);
}

/** A weather's dwell in weather-clock minutes. */
export const dwellFor = (weather, rng) => range(rng, weather.dwell[0], weather.dwell[1]);

/**
 * A new world: the clock at the chosen (or the place's) hour, or the device's; the weather as
 * set, lasting at least its dwell.
 */
export function createWorld({ conditions, timeMode, regionWeather, now, rng }) {
  const clock = timeMode === 'local' ? localMinutes(new Date(now)) : phaseMiddle(conditions.time);
  return {
    clock,
    weather: conditions.weather,
    weatherClock: 0,
    weatherUntil: dwellFor(regionWeather, rng),
    front: null, // { weather, at }: a rainier weather on its way
  };
}

/**
 * Moves the world on by `seconds` of real (playing) time. Returns { world, time, weather,
 * cues } where `time` and `weather` are set only when they changed, and `cues` lists things
 * to play now ({ type: 'front', weather, thunder }: rain on its way, with the wind rising and,
 * where storms happen, a distant roll of thunder).
 */
export function stepWorld(world, { seconds, timeMode, speed, weatherMode, regionId, regionWeather, location, now, rng }) {
  const out = { world: { ...world }, time: null, weather: null, cues: [] };
  const w = out.world;
  const beforePhase = phaseAt(w.clock);
  if (timeMode === 'accelerated') w.clock = (w.clock + (seconds / 60) * speed) % DAY;
  else if (timeMode === 'local') w.clock = localMinutes(new Date(now));
  const phase = phaseAt(w.clock);
  if (timeMode !== 'fixed' && phase !== beforePhase) out.time = phase;

  if (weatherMode === 'simulated') {
    // A weather from another destination becomes this one's equivalent (or the place's own).
    const current = weatherFor(regionId, w.weather) || location.weather;
    if (current !== w.weather) {
      w.weather = current;
      out.weather = current;
    }
    w.weatherClock += (seconds / 60) * (timeMode === 'accelerated' ? speed : 1);
    if (w.front && w.weatherClock >= w.front.at) {
      w.weather = w.front.weather;
      w.front = null;
      w.weatherUntil = w.weatherClock + dwellFor(regionWeather, rng);
      out.weather = w.weather;
    } else if (!w.front && w.weatherClock >= w.weatherUntil) {
      const next = nextWeather(w.weather, regionWeather, rng);
      if (next === w.weather) {
        w.weatherUntil = w.weatherClock + dwellFor(regionWeather, rng) * 0.5;
      } else if (RAINIER.includes(next) && !RAINIER.includes(w.weather)) {
        // A front: announced now, here in a few simulated minutes.
        w.front = { weather: next, at: w.weatherClock + range(rng, 3, 6) };
        out.cues.push({ type: 'front', weather: next, thunder: regionWeather.allowed.includes('thunderstorm') && rng() < 0.6 });
      } else {
        w.weather = next;
        w.weatherUntil = w.weatherClock + dwellFor(regionWeather, rng);
        out.weather = next;
      }
    }
  }
  return out;
}

export { TIME_IDS };
