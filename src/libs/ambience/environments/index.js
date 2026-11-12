// The ambience environments, in the order the Atmosphere panel shows them. Each is a plain
// definition: { id, name, subtitle, palette, layers: [{ id, label, level, scale }], create(kit,
// { params }) → { levels, apply(params), schedule(from, to), randomize(rng) } }. A new one
// needs no engine changes.
import rainyMood from './rainyMood.js';
import deepSpace from './deepSpace.js';
import forest from './forest.js';
import ocean from './ocean.js';
import fireplace from './fireplace.js';
import dreamscape from './dreamscape.js';

export const ENVIRONMENTS = [rainyMood, deepSpace, forest, ocean, fireplace, dreamscape];
export const DEFAULT_ENVIRONMENT = rainyMood.id;

const byId = new Map(ENVIRONMENTS.map((e) => [e.id, e]));
export const environmentById = (id) => byId.get(id) || null;

/** The next environment after `id` (wrapping), for the island's Next button. */
export function nextEnvironmentId(id) {
  const i = ENVIRONMENTS.findIndex((e) => e.id === id);
  return ENVIRONMENTS[(i + 1) % ENVIRONMENTS.length].id;
}

/** Is this a usable environment definition? (Guards the engine against a bad one.) */
export function validEnvironment(env) {
  return Boolean(env && typeof env.id === 'string' && typeof env.create === 'function'
    && Array.isArray(env.layers) && env.layers.length > 0 && env.layers.length <= 5
    && env.layers.every((l) => typeof l.id === 'string' && Number.isFinite(l.level) && Number.isFinite(l.scale)));
}
