// The ambience environments. Each is a plain definition: { id, name, subtitle, palette,
// layers: [{ id, label, level, scale }], create(kit, { params }) → { levels, apply(params),
// schedule(from, to), randomize(rng) } }. A new one needs no engine changes.
//
//   ENVIRONMENTS           the six classic ones, in the order the Atmosphere panel shows them
//   FRONTIER_ENVIRONMENTS  Frontier World's locations (frontier/), one environment each
//   ALL_ENVIRONMENTS       both: what the engine can play and what settings keep a mix for
import rainyMood from './rainyMood.js';
import deepSpace from './deepSpace.js';
import forest from './forest.js';
import ocean from './ocean.js';
import fireplace from './fireplace.js';
import dreamscape from './dreamscape.js';
import { FRONTIER_ENVIRONMENTS } from '../frontier/environments.js';

export const ENVIRONMENTS = [rainyMood, deepSpace, forest, ocean, fireplace, dreamscape];
export { FRONTIER_ENVIRONMENTS };
export const ALL_ENVIRONMENTS = [...ENVIRONMENTS, ...FRONTIER_ENVIRONMENTS];
export const DEFAULT_ENVIRONMENT = rainyMood.id;
export const MAX_LAYERS = 8;

const byId = new Map(ALL_ENVIRONMENTS.map((e) => [e.id, e]));
export const environmentById = (id) => byId.get(id) || null;
export const isFrontier = (id) => Boolean(byId.get(id)?.frontier);

/**
 * The next environment after `id` (wrapping), for the island's Next button: the next classic
 * environment, or for a Frontier location the next location in its region.
 */
export function nextEnvironmentId(id) {
  const env = byId.get(id);
  const list = env?.frontier
    ? FRONTIER_ENVIRONMENTS.filter((e) => e.frontier.regionId === env.frontier.regionId)
    : ENVIRONMENTS;
  const i = list.findIndex((e) => e.id === id);
  return list[(i + 1) % list.length].id;
}

/** Is this a usable environment definition? (Guards the engine against a bad one.) */
export function validEnvironment(env) {
  return Boolean(env && typeof env.id === 'string' && typeof env.create === 'function'
    && Array.isArray(env.layers) && env.layers.length > 0 && env.layers.length <= MAX_LAYERS
    && env.layers.every((l) => typeof l.id === 'string' && Number.isFinite(l.level) && Number.isFinite(l.scale)));
}
