// Frontier locations as Atmosphere environments: each one is played by the same engine as the
// other environments (one AudioContext, crossfades, disposal, the island, the glow, focus
// sessions, evolution and the stereo image all apply unchanged). On top of the usual
// environment interface ({ levels, apply, schedule, randomize, evolve }), a Frontier instance
// has
//   setConditions({ time, weather, progress }, tc)  the hour (and how far into it) and the weather
//   setTune({ eventIntensity, weatherIntensity, lite })  how busy and how strong (0–1 each)
//   setMusic({ enabled, volume, mood, radio }, tc)  the generated music (music.js)
//   cue({ type: 'front', weather, thunder })  the world clock's moments (world.js)
// and the engine knows it's one by `env.frontier`.
import { LOCATIONS, regionById } from './catalogue.js';
import { conditionMult, weatherAudible } from './conditions.js';
import { buildLayer, KINDS } from './sounds.js';
import { budgetMax, createBudget, createDirector } from './events.js';
import { createMusic } from './music.js';
import { range } from '../random.js';
import { glide } from '../voices.js';

// How far evolution may move each kind of layer (× its mix level).
const EVOLUTION_RANGES = {
  air: [0.85, 1.1],
  wind: [0.6, 1.25],
  foliage: [0.55, 1.2],
  water: [0.8, 1.1],
  insects: [0.5, 1.2],
  frogs: [0.45, 1.25],
  birds: [0.35, 1.25],
  wildlife: [0.6, 1.2],
  distant: [0.6, 1.2],
  fire: [0.85, 1.1],
  weather: [0.9, 1.05],
};

// Kinds with a source somewhere in the scene (not all around): each place puts them in their
// own spot, the same every time, so the creek at Alder Creek is always where it was.
const PLACED = { water: 0.6, distant: 0.6, fire: 0.25, frogs: 0.4, foliage: 0.35 };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A layer's place in the stereo field at a location (−1 left … 1 right), fixed per place. */
export function placeOf(locationId, layer) {
  const reach = PLACED[layer.kind];
  const space = KINDS[layer.kind].space;
  if (!reach) return space;
  const unit = (hash(`${locationId}/${layer.id}`) % 2001) / 1000 - 1; // −1 … 1
  return { ...space, pos: Math.round(unit * reach * 100) / 100 };
}

function environmentFor(location) {
  const region = regionById(location.regionId);
  return {
    id: location.id,
    name: location.name,
    subtitle: region.name,
    palette: region.palette,
    accent: region.accent,
    glow: region.glow,
    frontier: { regionId: region.id, locationId: location.id },
    maxVoices: 28,
    layers: location.layers.map((l) => ({
      id: l.id,
      label: l.label,
      level: l.level,
      scale: KINDS[l.kind].scale,
      kind: l.kind,
      space: placeOf(location.id, l),
    })),
    evolution: {
      layers: Object.fromEntries(location.layers.map((l) => [l.id, { range: EVOLUTION_RANGES[l.kind] }])),
      params: { mood: 0.12, variation: 0.1, depth: 0.05 },
    },

    create(kit, { params }) {
      const { rng } = kit;
      const tune = { eventIntensity: 0.5, weatherIntensity: 0.5, lite: false };
      const budget = createBudget({ max: () => budgetMax(tune.eventIntensity) });
      const shared = { gustRate: range(rng, 0.035, 0.06), budget, tune };
      const built = location.layers.map((def) => ({ def, api: buildLayer(kit, def, shared) }));
      const levels = Object.fromEntries(built.map(({ def, api }) => [def.id, api.gain]));
      // The director reaches each layer by its kind (the first of a kind).
      const byKind = new Map();
      for (const { def, api } of built) if (!byKind.has(def.kind)) byKind.set(def.kind, { gain: api.gain, api });
      const director = createDirector({ kit, pool: location.events, layers: byKind, rng, budget, tune });
      const music = createMusic(kit);
      let cond = { time: location.time, weather: location.weather, progress: 0.5 };

      const apply = (p) => {
        for (const { api } of built) {
          api.apply(p);
          // Depth: a little more of the place's space (the shared reverb) as it deepens.
          glide(api.layer.reverb.gain, api.rev * (0.6 + p.depth * 0.8), kit.ctx, 1.5);
        }
        director.apply(p);
      };

      const setConditions = (next, tc = 3) => {
        cond = { time: next.time, weather: next.weather, progress: next.progress ?? 0.5 };
        const mults = {};
        for (const { def, api } of built) {
          const m = conditionMult(api.category, cond.time, cond.weather);
          mults[def.kind] = Math.max(mults[def.kind] ?? 0, m);
          api.setConditions(m, cond, tc);
        }
        director.setConditions(cond, mults);
      };

      setConditions(cond, 0.05);
      apply(params);

      return {
        levels,
        apply,
        setConditions,
        setTune(next, tc = 2) {
          const weatherChanged = next.weatherIntensity !== undefined && next.weatherIntensity !== tune.weatherIntensity;
          Object.assign(tune, next);
          // Weather Intensity is a level: send the conditions again so it moves now.
          if (weatherChanged) setConditions(cond, tc);
        },
        setMusic: (m, tc) => music.set(m, tc),
        cue(c) {
          if (c?.type !== 'front') return;
          const t = kit.ctx.currentTime + 0.5;
          byKind.get('wind')?.api.gustAt?.(t, 1.2);
          if (c.thunder) byKind.get('weather')?.api.distantThunder?.(t + range(rng, 2, 6));
        },
        schedule(from, to) {
          for (const { api } of built) api.schedule(from, to);
          director.schedule(from, to);
          music.schedule(from, to);
        },
        randomize(r) {
          for (const { api } of built) api.randomize(r);
        },
        evolve(r) {
          for (const { api } of built) api.evolve(r);
        },
        /** For the panel and tests: what's happening now. */
        info: () => ({
          conditions: { time: cond.time, weather: cond.weather },
          music: { enabled: music.enabled(), mood: music.mood(), radio: music.radio(), section: music.section() },
          tune: { ...tune },
          events: director.history(),
          weatherAudible: weatherAudible(cond.weather),
        }),
      };
    },
  };
}

export const FRONTIER_ENVIRONMENTS = Object.freeze(LOCATIONS.map(environmentFor));
