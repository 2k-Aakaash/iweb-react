// Atmosphere Scenes: one-click configurations of an environment (its layers and character)
// with evolution and stereo settings. An environment is the sound palette and its generator;
// a scene is a tuned starting point in one. Built-in scenes are part of the code (they can't
// be damaged); the user's own scenes are saved in iWebDB (prefs.js) as plain data, never
// audio. Applying a scene keeps the master volume.
//
//   scene  { id, name, description, environmentId, version: 2, builtIn,
//            parameters: { mood, variation, depth, evolutionMode, spatialWidth, movement },
//            layers: { [layerId]: 0–1 }, seed: integer | null }
//
// Version 1 records were the old presets: { id, name, environmentId, masterVolume, params,
// layers, seed }. They're read as scenes with Gentle evolution and the default stereo image;
// their volume is no longer applied (scenes keep the volume you've set).
import { environmentById } from './environments/index.js';
import { validMode } from './evolution.js';

export const SCENE_VERSION = 2;
export const MAX_CUSTOM_SCENES = 24;
export const DEFAULT_SPATIAL = Object.freeze({ width: 0.6, movement: 0.35 });
export const DEFAULT_PARAMS = Object.freeze({ mood: 0.35, variation: 0.45, depth: 0.55 });

const unit = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const ID = /^[a-z0-9-]{1,40}$/;

/** A scene from anything (a built-in definition, a saved record, an old preset), or null. */
export function normalizeScene(raw, { builtIn = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const env = environmentById(raw.environmentId);
  if (!env) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const p = raw.parameters && typeof raw.parameters === 'object' ? raw.parameters : {};
  const legacy = raw.params && typeof raw.params === 'object' ? raw.params : {}; // version 1
  const layers = Object.fromEntries(env.layers.map((l) => [l.id, unit(raw.layers?.[l.id], l.level)]));
  return {
    id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : `s-${Math.random().toString(36).slice(2, 10)}`,
    name,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 120) : '',
    environmentId: env.id,
    version: SCENE_VERSION,
    builtIn,
    parameters: {
      mood: unit(p.mood ?? legacy.mood, DEFAULT_PARAMS.mood),
      variation: unit(p.variation ?? legacy.variation, DEFAULT_PARAMS.variation),
      depth: unit(p.depth ?? legacy.depth, DEFAULT_PARAMS.depth),
      evolutionMode: validMode(p.evolutionMode),
      spatialWidth: unit(p.spatialWidth, DEFAULT_SPATIAL.width),
      movement: unit(p.movement, DEFAULT_SPATIAL.movement),
    },
    layers,
    seed: Number.isInteger(raw.seed) && raw.seed >= 0 ? raw.seed : null,
  };
}

/** The user's scenes from storage (invalid ones dropped), or null for something unusable. */
export function normalizeScenes(v) {
  if (!Array.isArray(v)) return null;
  const seen = new Set();
  return v
    .map((s) => normalizeScene(s))
    .filter((s) => s && !seen.has(s.id) && !BUILT_IN_IDS.has(s.id) && seen.add(s.id))
    .slice(0, MAX_CUSTOM_SCENES);
}

// Tuned starting points. Seeds are fixed so a scene sounds like itself each time.
const DEFINITIONS = [
  {
    id: 'deep-focus',
    name: 'Deep Focus',
    description: 'A steady drone, soft pads and very few bells.',
    environmentId: 'deep-space',
    parameters: { mood: 0.22, variation: 0.25, depth: 0.6, evolutionMode: 'gentle', spatialWidth: 0.55, movement: 0.25 },
    layers: { drone: 0.62, pads: 0.42, texture: 0.12, melody: 0.12 },
    seed: 1207,
  },
  {
    id: 'midnight-coding',
    name: 'Midnight Coding',
    description: 'Soft piano over pads, with a restrained shimmer.',
    environmentId: 'dreamscape',
    parameters: { mood: 0.3, variation: 0.35, depth: 0.55, evolutionMode: 'gentle', spatialWidth: 0.6, movement: 0.3 },
    layers: { piano: 0.42, pads: 0.45, shimmer: 0.14, air: 0.18 },
    seed: 4410,
  },
  {
    id: 'rainy-reading',
    name: 'Rainy Reading',
    description: 'Rain in front, sparse piano, hardly any thunder.',
    environmentId: 'rainy-mood',
    parameters: { mood: 0.3, variation: 0.2, depth: 0.5, evolutionMode: 'gentle', spatialWidth: 0.7, movement: 0.25 },
    layers: { rain: 0.82, wind: 0.2, thunder: 0.15, piano: 0.3 },
    seed: 2718,
  },
  {
    id: 'forest-escape',
    name: 'Forest Escape',
    description: 'Gentle wind, leaves, a brook and birds that come and go.',
    environmentId: 'forest',
    parameters: { mood: 0.45, variation: 0.55, depth: 0.45, evolutionMode: 'organic', spatialWidth: 0.75, movement: 0.45 },
    layers: { wind: 0.35, leaves: 0.4, brook: 0.32, birds: 0.38 },
    seed: 905,
  },
  {
    id: 'ocean-meditation',
    name: 'Ocean Meditation',
    description: 'Slow waves and a deep body, little else.',
    environmentId: 'ocean',
    parameters: { mood: 0.18, variation: 0.3, depth: 0.65, evolutionMode: 'gentle', spatialWidth: 0.65, movement: 0.3 },
    layers: { waves: 0.72, foam: 0.25, wind: 0.15, deep: 0.42 },
    seed: 6060,
  },
  {
    id: 'late-night',
    name: 'Late Night',
    description: 'Deep space, low and slow, with the highs held back.',
    environmentId: 'deep-space',
    parameters: { mood: 0.12, variation: 0.2, depth: 0.8, evolutionMode: 'gentle', spatialWidth: 0.5, movement: 0.2 },
    layers: { drone: 0.55, pads: 0.38, texture: 0.06, melody: 0.08 },
    seed: 3141,
  },
  {
    id: 'fireside',
    name: 'Fireside',
    description: 'A warm fire crackling softly in a quiet room.',
    environmentId: 'fireplace',
    parameters: { mood: 0.3, variation: 0.35, depth: 0.55, evolutionMode: 'gentle', spatialWidth: 0.55, movement: 0.2 },
    layers: { fire: 0.55, crackle: 0.42, embers: 0.18, room: 0.32 },
    seed: 1789,
  },
];

export const BUILT_IN_SCENES = Object.freeze(DEFINITIONS.map((d) => Object.freeze(normalizeScene(d, { builtIn: true }))));
const BUILT_IN_IDS = new Set(BUILT_IN_SCENES.map((s) => s.id));
const byId = new Map(BUILT_IN_SCENES.map((s) => [s.id, s]));

export const builtInScene = (id) => byId.get(id) || null;

/** A scene by id among the built-in and the user's scenes. */
export function findScene(id, custom = []) {
  if (typeof id !== 'string') return null;
  return byId.get(id) || custom.find((s) => s.id === id) || null;
}
