// Frontier time of day and weather: a simulated atmosphere, never a forecast. Pure functions:
// what a condition does to each kind of sound, which conditions a destination allows, and how
// the world moves from one to the next.
//
// Each layer kind has a category, and each category a multiplier per time and per weather.
// Continuous sounds (wind, water, rain) take it as a level; event sounds (birds, frogs, calls)
// take it as how often they happen, so a quiet hour is sparser, not just softer.
//
// Weathers: seven everywhere a destination allows them (Clear, Partly Cloudy, Overcast, Light
// Rain, Heavy Rain, Thunderstorm, Fog) and three that belong to particular country: Snowfall
// (Ironpeak), Windy (the exposed plains and peaks) and Dust Wind (Sunscour).
import { regionById } from './catalogue.js';
import { weighted } from '../random.js';

export const TIMES = Object.freeze([
  { id: 'dawn', label: 'Dawn' },
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
]);

export const WEATHERS = Object.freeze([
  { id: 'clear', label: 'Clear' },
  { id: 'partly-cloudy', label: 'Partly Cloudy' },
  { id: 'overcast', label: 'Overcast' },
  { id: 'light-rain', label: 'Light Rain' },
  { id: 'heavy-rain', label: 'Heavy Rain' },
  { id: 'thunderstorm', label: 'Thunderstorm' },
  { id: 'fog', label: 'Fog' },
  { id: 'snowfall', label: 'Snowfall' },
  { id: 'windy', label: 'Windy' },
  { id: 'dust-wind', label: 'Dust Wind' },
]);

export const TIME_IDS = TIMES.map((t) => t.id);
export const WEATHER_IDS = WEATHERS.map((w) => w.id);
export const timeLabel = (id) => TIMES.find((t) => t.id === id)?.label || '';
export const weatherLabel = (id) => WEATHERS.find((w) => w.id === id)?.label || '';

/** A saved time id as it is now (Evening became Dusk), or null for anything unknown. */
export const currentTime = (t) => (t === 'evening' ? 'dusk' : TIME_IDS.includes(t) ? t : null);

// The category of each layer kind (sounds.js).
export const CATEGORY = Object.freeze({
  air: 'air',
  wind: 'wind',
  foliage: 'foliage',
  water: 'water',
  insects: 'insects',
  frogs: 'frogs',
  birds: 'birds',
  wildlife: 'wildlife',
  distant: 'human',
  fire: 'fire',
  weather: 'weather',
});

// Per category: [dawn, morning, afternoon, dusk, night]. Insects are 1 throughout: their layer
// swaps day insects for night ones itself (cicadas by day, crickets after dark).
const BY_TIME = {
  air: [0.9, 1, 1, 0.95, 0.85],
  wind: [0.75, 0.9, 1.1, 0.95, 0.8],
  foliage: [0.7, 0.9, 1.1, 0.95, 0.75],
  water: [1, 1, 1, 1, 1],
  insects: [1, 1, 1, 1, 1],
  frogs: [0.55, 0.2, 0.2, 1, 1.25],
  birds: [1.5, 1.15, 0.7, 0.55, 0.05],
  wildlife: [0.8, 0.6, 0.55, 0.9, 1.15],
  human: [0.45, 1, 1, 0.6, 0.2],
  fire: [1, 1, 1, 1.1, 1.15],
  weather: [1, 1, 1, 1, 1],
};

// Per weather, per category.
const W = (air, wind, foliage, water, insects, frogs, birds, wildlife, human, fire) => ({ air, wind, foliage, water, insects, frogs, birds, wildlife, human, fire, weather: 1 });
const BY_WEATHER = {
  clear: W(1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  'partly-cloudy': W(1, 1.05, 1.05, 1, 0.95, 1, 0.95, 1, 1, 1),
  overcast: W(1, 1.15, 1.1, 1, 0.75, 1.1, 0.75, 0.9, 0.9, 1),
  'light-rain': W(0.9, 1.1, 1, 1.05, 0.4, 1.4, 0.45, 0.5, 0.6, 1),
  'heavy-rain': W(0.7, 1.25, 1.15, 1.15, 0.1, 1.2, 0.12, 0.2, 0.35, 1),
  thunderstorm: W(0.7, 1.45, 1.3, 1.15, 0.08, 1, 0.06, 0.15, 0.3, 1),
  fog: W(0.9, 0.6, 0.6, 0.95, 0.6, 1.1, 0.5, 0.8, 0.7, 1),
  snowfall: W(0.8, 1.35, 0.6, 0.85, 0, 0, 0.35, 0.55, 0.5, 1),
  windy: W(0.9, 1.85, 1.7, 1.05, 0.5, 0.7, 0.5, 0.6, 0.75, 1.1),
  'dust-wind': W(0.85, 1.9, 1.6, 1, 0.3, 0.5, 0.35, 0.5, 0.7, 1.1),
};

const timeIndex = (t) => Math.max(0, TIME_IDS.indexOf(t));

/** The multiplier for a category of sound at this time and in this weather. */
export function conditionMult(category, time, weather) {
  const t = BY_TIME[category];
  const w = (BY_WEATHER[weather] || BY_WEATHER.clear)[category];
  if (!t || w === undefined) return 1;
  return t[timeIndex(time)] * w;
}

// The weather layer: how much rain, snow, wind-blown debris and thunder each weather brings.
const WEATHER_MIX = {
  clear: { rain: 0, snow: 0, debris: 0, thunder: 0 },
  'partly-cloudy': { rain: 0, snow: 0, debris: 0, thunder: 0 },
  overcast: { rain: 0, snow: 0, debris: 0, thunder: 0.05 },
  'light-rain': { rain: 0.4, snow: 0, debris: 0, thunder: 0 },
  'heavy-rain': { rain: 0.85, snow: 0, debris: 0, thunder: 0.15 },
  thunderstorm: { rain: 1, snow: 0, debris: 0.25, thunder: 1 },
  fog: { rain: 0, snow: 0, debris: 0, thunder: 0 },
  snowfall: { rain: 0, snow: 1, debris: 0, thunder: 0 },
  windy: { rain: 0, snow: 0, debris: 1, thunder: 0 },
  'dust-wind': { rain: 0, snow: 0, debris: 1.3, thunder: 0 },
};
export const weatherMix = (weather) => WEATHER_MIX[weather] || WEATHER_MIX.clear;

/** Does the weather layer make any sound in this weather? */
export const weatherAudible = (weather) => {
  const m = weatherMix(weather);
  return m.rain > 0 || m.snow > 0 || m.debris > 0 || m.thunder > 0.1;
};

/** What the weather layer is doing when it's mostly quiet (for the panel), or null. */
export function weatherNote(weather) {
  if (weather === 'overcast') return 'Only distant thunder, now and then';
  if (!weatherAudible(weather)) return `Silent in ${weatherLabel(weather).toLowerCase()} weather`;
  return null;
}

/** A destination's weather: { allowed, weights, dwell }. */
export const regionWeather = (regionId) => regionById(regionId)?.weather || { allowed: ['clear'], weights: { clear: 1 }, dwell: [60, 120] };
/** The weathers a destination allows (snowfall only where it can snow). */
export const regionWeathers = (regionId) => regionWeather(regionId).allowed;

// A wind chosen in one country and heard in another becomes that country's own wind.
const WEATHER_ALIAS = { windy: 'dust-wind', 'dust-wind': 'windy' };

/** A weather as this destination has it: itself, its local equivalent, or null. */
export function weatherFor(regionId, weather) {
  const allowed = regionWeathers(regionId);
  if (allowed.includes(weather)) return weather;
  const alias = WEATHER_ALIAS[weather];
  return alias && allowed.includes(alias) ? alias : null;
}

/**
 * The conditions a location plays with: the user's chosen time and weather (null: the
 * location's own; a weather the destination doesn't have falls back to the location's), and
 * the world's drift, when it's on, takes over.
 */
export function effectiveConditions(location, prefs = {}, drift = null) {
  if (!location) return null;
  const pick = (time, weather) => ({
    time: currentTime(time) || location.time,
    weather: weatherFor(location.regionId, weather) || location.weather,
  });
  const set = pick(prefs.time, prefs.weather);
  if (drift) {
    const d = pick(drift.time ?? prefs.time, drift.weather ?? prefs.weather);
    return { ...d, source: 'dynamic', isDefault: false };
  }
  return { ...set, source: prefs.time || prefs.weather ? 'set' : 'default', isDefault: set.time === location.time && set.weather === location.weather };
}

// How weather moves when it changes on its own: to a neighbour, never from clear sky straight
// into a thunderstorm.
export const NEIGHBOURS = Object.freeze({
  clear: ['partly-cloudy', 'windy', 'dust-wind', 'fog'],
  'partly-cloudy': ['clear', 'overcast', 'windy', 'dust-wind'],
  overcast: ['partly-cloudy', 'light-rain', 'fog', 'snowfall', 'windy'],
  'light-rain': ['overcast', 'heavy-rain', 'fog'],
  'heavy-rain': ['light-rain', 'thunderstorm'],
  thunderstorm: ['heavy-rain'],
  fog: ['clear', 'overcast', 'light-rain'],
  snowfall: ['overcast'],
  windy: ['clear', 'partly-cloudy', 'overcast'],
  'dust-wind': ['clear', 'partly-cloudy'],
});

/**
 * One step of the drift: the hour moves on now and then, and the weather drifts to a
 * neighbouring one the destination allows, by its weights (or stays). Returns { time, weather }.
 */
export function driftStep({ time, weather }, weathers, rng, weights = null) {
  let nextTime = time;
  if (rng() < 0.45) nextTime = TIME_IDS[(timeIndex(time) + 1) % TIME_IDS.length];
  let nextWeather = weather;
  const options = (NEIGHBOURS[weather] || []).filter((w) => weathers.includes(w));
  if (options.length && rng() < 0.5) {
    // The destination's own weather weights; storms clear more readily than they build.
    const w = options.map((o) => (weights?.[o] ?? 1) * (WEATHER_IDS.indexOf(o) < WEATHER_IDS.indexOf(weather) ? 1.4 : 1));
    nextWeather = weighted(rng, options, w);
  }
  if (!weathers.includes(nextWeather)) nextWeather = weathers[0];
  return { time: nextTime, weather: nextWeather };
}

/** Seconds between drift steps: slow enough to be noticed only in hindsight. */
export const driftWait = (rng) => 300 + rng() * 300;
