// Atmosphere's saved settings and scenes (iWebDB through libs/prefs/storedPref.js, so they are
// in backups). Everything is validated: a damaged or old value falls back to defaults and can
// never stop iWeb from loading. Nothing here is audio, and nothing here starts playback.
//
//   settings (v2) {
//     v: 2, environmentId, masterVolume,
//     environments: { [id]: { layers: {..}, params: { mood, variation, depth } } },
//     sceneId,                                   the scene last applied (or null)
//     evolution: 'off' | 'gentle' | 'dynamic' | 'organic',
//     spatial: { width, movement },
//     glow: { enabled, reactive }, visualizer,   visual effects
//     sleepMinutes, focus: { minutes, end: 'stop' | 'pause' },
//     favorites: [sceneId],
//     suggest: { wallpaper, time },              wallpaper-linked and time-aware suggestions
//     links: { 'local:12' | 'unsplash:abc': sceneId }   a wallpaper's scene
//   }
//   v1 (Atmosphere 1) had no `v` and none of the fields after `environments` but glow and sleepMinutes:
//   they're added with defaults, everything else is kept.
//
//   scenes  the user's scenes (scenes.js; the old presets are read as scenes)
import { createStoredPref } from '../prefs/storedPref.js';
import { DEFAULT_ENVIRONMENT, ENVIRONMENTS, environmentById } from './environments/index.js';
import { validMode } from './evolution.js';
import { DEFAULT_PARAMS, DEFAULT_SPATIAL, normalizeScene, normalizeScenes } from './scenes.js';

export { DEFAULT_PARAMS } from './scenes.js';
export const SETTINGS_VERSION = 2;
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
  return { layers, params };
}

export function defaultSettings() {
  return {
    v: SETTINGS_VERSION,
    environmentId: DEFAULT_ENVIRONMENT,
    masterVolume: 0.6,
    environments: Object.fromEntries(ENVIRONMENTS.map((e) => [e.id, normalizeEnvSettings(e.id, null)])),
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
    environmentId: environmentById(v.environmentId) ? v.environmentId : base.environmentId,
    masterVolume: unit(v.masterVolume, base.masterVolume),
    environments: Object.fromEntries(ENVIRONMENTS.map((e) => [e.id, normalizeEnvSettings(e.id, v.environments?.[e.id])])),
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
