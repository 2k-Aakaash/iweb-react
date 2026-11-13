// Atmosphere's saved settings and scenes (iWebDB through libs/prefs/storedPref.js, so they are
// in backups). Everything is validated: a damaged or old value falls back to defaults and can
// never stop iWeb from loading. Nothing here is audio, and nothing here starts playback.
//
//   settings (v4) {
//     v: 4, environmentId, masterVolume,
//     environments: { [id]: { layers: {..}, muted: { [layerId]: true }, params: { mood, variation, depth } } },
//     sceneId,                                   the scene last applied (or null)
//     evolution: 'off' | 'gentle' | 'dynamic' | 'organic',
//     spatial: { width, movement },
//     glow: { enabled, reactive }, visualizer,   visual effects
//     sleepMinutes, focus: { minutes, end: 'stop' | 'pause' },
//     favorites: [sceneId],
//     suggest: { wallpaper, time },              wallpaper-linked and time-aware suggestions
//     links: { 'local:12' | 'unsplash:abc': sceneId }   a wallpaper's scene
//     frontier: {                               Frontier World (frontier/)
//       regionId, locationId,                   the destination and place last visited
//       mode: 'environmental' | 'cinematic' | 'radio',
//       time, timeMode: 'fixed' | 'local' | 'accelerated', speed,
//                                               the hour (null: the place's own), how it moves
//                                               and, accelerated, how fast (simulated minutes
//                                               per real minute)
//       weather, weatherMode: 'locked' | 'simulated', weatherIntensity,
//       eventIntensity, ambienceVolume,         0–1 each (0.5: as designed; ambience 1: full)
//       music: { mood, cinematicVolume, radioVolume }   'auto' or a mood id; a volume per mode
//     }
//   }
//   v3 had `dynamic` (both time and weather drifting) and `music: { enabled, volume }`: they
//   become timeMode 'accelerated' + weatherMode 'simulated', and mode 'cinematic' with its
//   volume. Places renamed before release keep their mix (catalogue.js LEGACY_LOCATION_IDS),
//   and a saved 'evening' is Dusk.
//   v2 had no `muted` and no `frontier`: they're added with defaults, everything else is kept.
//   v1 (Atmosphere 1) had no `v` and none of the fields after `environments` but glow and sleepMinutes:
//   they're added with defaults, everything else is kept.
//
//   scenes  the user's scenes (scenes.js; the old presets are read as scenes)
import { createStoredPref } from '../prefs/storedPref.js';
import { ALL_ENVIRONMENTS, DEFAULT_ENVIRONMENT, environmentById } from './environments/index.js';
import { currentLocationId, DEFAULT_LOCATION, LEGACY_LOCATION_IDS, locationById, regionById } from './frontier/catalogue.js';
import { currentTime, WEATHER_IDS } from './frontier/conditions.js';
import { validMood } from './frontier/music.js';
import { validMode } from './evolution.js';
import { DEFAULT_PARAMS, DEFAULT_SPATIAL, normalizeScene, normalizeScenes } from './scenes.js';

export { DEFAULT_PARAMS } from './scenes.js';
export const SETTINGS_VERSION = 4;
export const FRONTIER_MODES = Object.freeze(['environmental', 'cinematic', 'radio']);
export const TIME_MODES = Object.freeze(['fixed', 'local', 'accelerated']);
export const WEATHER_MODES = Object.freeze(['locked', 'simulated']);
export const SPEEDS = Object.freeze([2, 6, 12, 24]); // simulated minutes per real minute
export const PARAMS = ['mood', 'variation', 'depth'];
export const SLEEP_OPTIONS = [15, 30, 60, 120];
export const FOCUS_OPTIONS = [25, 45, 60, 90];
const MAX_FAVORITES = 24;
const MAX_LINKS = 200;
const SCENE_ID = /^[a-z0-9-]{1,40}$/;
const WALLPAPER_KEY = /^(local|unsplash):[\w-]{1,80}$/;

const unit = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function defaultLayers(envId) {
  const env = environmentById(envId);
  return env ? Object.fromEntries(env.layers.map((l) => [l.id, l.level])) : {};
}

function normalizeEnvSettings(envId, raw) {
  const env = environmentById(envId);
  const layers = Object.fromEntries(env.layers.map((l) => [l.id, unit(raw?.layers?.[l.id], l.level)]));
  const params = Object.fromEntries(PARAMS.map((k) => [k, unit(raw?.params?.[k], DEFAULT_PARAMS[k])]));
  const muted = {};
  for (const l of env.layers) if (raw?.muted?.[l.id] === true) muted[l.id] = true;
  return { layers, muted, params };
}

export function defaultFrontier() {
  const loc = locationById(DEFAULT_LOCATION);
  return {
    regionId: loc.regionId,
    locationId: loc.id,
    mode: 'environmental',
    time: null,
    timeMode: 'fixed',
    speed: 6,
    weather: null,
    weatherMode: 'locked',
    weatherIntensity: 0.5,
    eventIntensity: 0.5,
    ambienceVolume: 1,
    music: { mood: 'auto', cinematicVolume: 0.45, radioVolume: 0.75 },
  };
}

const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);

function normalizeFrontier(raw) {
  const base = defaultFrontier();
  if (!raw || typeof raw !== 'object') return base;
  const loc = locationById(raw.locationId);
  // v3: one Dynamic Atmosphere switch, and music on or off.
  const v3Dynamic = raw.timeMode === undefined && raw.weatherMode === undefined ? raw.dynamic === true : false;
  const v3Mode = raw.mode === undefined && raw.music?.enabled === true ? 'cinematic' : undefined;
  return {
    regionId: regionById(raw.regionId) ? raw.regionId : loc?.regionId ?? base.regionId,
    locationId: loc ? loc.id : base.locationId,
    mode: oneOf(FRONTIER_MODES, raw.mode ?? v3Mode, base.mode),
    time: currentTime(raw.time),
    timeMode: oneOf(TIME_MODES, raw.timeMode ?? (v3Dynamic ? 'accelerated' : undefined), base.timeMode),
    speed: oneOf(SPEEDS, raw.speed, base.speed),
    weather: WEATHER_IDS.includes(raw.weather) ? raw.weather : null,
    weatherMode: oneOf(WEATHER_MODES, raw.weatherMode ?? (v3Dynamic ? 'simulated' : undefined), base.weatherMode),
    weatherIntensity: unit(raw.weatherIntensity, base.weatherIntensity),
    eventIntensity: unit(raw.eventIntensity, base.eventIntensity),
    ambienceVolume: unit(raw.ambienceVolume, base.ambienceVolume),
    music: {
      mood: validMood(raw.music?.mood),
      cinematicVolume: unit(raw.music?.cinematicVolume ?? raw.music?.volume, base.music.cinematicVolume),
      radioVolume: unit(raw.music?.radioVolume, base.music.radioVolume),
    },
  };
}

// For each place, the id it was saved under before it was renamed (if any).
const LEGACY_FOR = Object.fromEntries(Object.entries(LEGACY_LOCATION_IDS).map(([old, now]) => [now, old]));
const savedEnv = (envs, id) => envs?.[id] ?? (LEGACY_FOR[id] ? envs?.[LEGACY_FOR[id]] : undefined);

export function defaultSettings() {
  return {
    v: SETTINGS_VERSION,
    environmentId: DEFAULT_ENVIRONMENT,
    masterVolume: 0.6,
    environments: Object.fromEntries(ALL_ENVIRONMENTS.map((e) => [e.id, normalizeEnvSettings(e.id, null)])),
    sceneId: null,
    evolution: 'gentle',
    spatial: { ...DEFAULT_SPATIAL },
    glow: { enabled: true, reactive: true },
    visualizer: true,
    sleepMinutes: null,
    focus: { minutes: 25, end: 'stop' },
    favorites: [],
    suggest: { wallpaper: true, time: false },
    links: {},
    frontier: defaultFrontier(),
  };
}

/** A minutes value for a focus session: one of the options, or a custom 5–240. */
export const validFocusMinutes = (m) => (Number.isInteger(m) && m >= 5 && m <= 240 ? m : null);

export function normalizeSettings(v) {
  if (!v || typeof v !== 'object') return null;
  const base = defaultSettings();
  const links = {};
  if (v.links && typeof v.links === 'object') {
    for (const [key, sceneId] of Object.entries(v.links).slice(0, MAX_LINKS)) {
      if (WALLPAPER_KEY.test(key) && typeof sceneId === 'string' && SCENE_ID.test(sceneId)) links[key] = sceneId;
    }
  }
  return {
    v: SETTINGS_VERSION,
    environmentId: environmentById(currentLocationId(v.environmentId)) ? currentLocationId(v.environmentId) : base.environmentId,
    masterVolume: unit(v.masterVolume, base.masterVolume),
    environments: Object.fromEntries(ALL_ENVIRONMENTS.map((e) => [e.id, normalizeEnvSettings(e.id, savedEnv(v.environments, e.id))])),
    sceneId: typeof v.sceneId === 'string' && SCENE_ID.test(v.sceneId) ? v.sceneId : null,
    evolution: validMode(v.evolution),
    spatial: {
      width: unit(v.spatial?.width, base.spatial.width),
      movement: unit(v.spatial?.movement, base.spatial.movement),
    },
    glow: {
      enabled: bool(v.glow?.enabled, base.glow.enabled),
      reactive: bool(v.glow?.reactive, base.glow.reactive),
    },
    visualizer: bool(v.visualizer, base.visualizer),
    sleepMinutes: SLEEP_OPTIONS.includes(v.sleepMinutes) ? v.sleepMinutes : null,
    focus: {
      minutes: validFocusMinutes(v.focus?.minutes) ?? base.focus.minutes,
      end: v.focus?.end === 'pause' ? 'pause' : 'stop',
    },
    favorites: Array.isArray(v.favorites)
      ? [...new Set(v.favorites.filter((id) => typeof id === 'string' && SCENE_ID.test(id)))].slice(0, MAX_FAVORITES)
      : [],
    suggest: {
      wallpaper: bool(v.suggest?.wallpaper, base.suggest.wallpaper),
      time: bool(v.suggest?.time, base.suggest.time),
    },
    links,
    frontier: normalizeFrontier(v.frontier),
  };
}

/** An old preset or a scene record, as a scene (kept for callers of the Atmosphere 1 name). */
export const normalizePreset = (p) => normalizeScene(p);
export const normalizePresets = normalizeScenes;

export const ambienceSettingsPref = createStoredPref({
  key: 'ambience_settings',
  mirrorKey: 'iweb:ambience',
  fallback: defaultSettings(),
  normalize: normalizeSettings,
  debounceMs: 500, // sliders: saved once they settle
});

// The user's scenes. The key is the one Atmosphere 1's presets used, so they carry over as scenes.
export const ambienceScenesPref = createStoredPref({
  key: 'ambience_presets',
  mirrorKey: 'iweb:ambiencePresets',
  fallback: [],
  normalize: normalizeScenes,
});
export const ambiencePresetsPref = ambienceScenesPref;
