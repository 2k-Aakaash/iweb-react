// Frontier World: the catalogue, time and weather, living-world events, the generated music,
// the engine's Frontier controls, persistence, and what the panel and island show. The audio
// clock is the fake's (fakeAudio.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AmbienceEngine } from '../engine.js';
import { environmentById, FRONTIER_ENVIRONMENTS, isFrontier, MAX_LAYERS, nextEnvironmentId, validEnvironment } from '../environments/index.js';
import { currentLocationId, FUTURE_REGIONS, LEGACY_LOCATION_IDS, LOCATIONS, REGIONS, WORLD, locationById, locationsIn } from '../frontier/catalogue.js';
import { ASSETS, SOURCE_KINDS, validateAsset, validateSource } from '../frontier/assets.js';
import { conditionMult, driftStep, effectiveConditions, regionWeathers, TIME_IDS, WEATHER_IDS, weatherAudible, weatherFor, weatherNote } from '../frontier/conditions.js';
import { createDirector, EVENTS, pickEvent } from '../frontier/events.js';
import { autoMood, barNotes, MOODS, MOOD_IDS } from '../frontier/music.js';
import { LAYER_KINDS } from '../frontier/sounds.js';
import { createKit } from '../voices.js';
import { normalizeSettings } from '../prefs.js';
import { normalizeScene } from '../scenes.js';
import { seeded } from '../random.js';
import { FakeAudioContext, memoryPref } from './fakeAudio.js';
import FrontierWorld from '../../../components/ambience/FrontierWorld.jsx';
import FrontierWindow from '../../../components/ambience/FrontierWindow.jsx';
import AmbienceIsland from '../../../components/ambience/AmbienceIsland.jsx';
import { _resetAmbience, getAmbience } from '../store.js';

vi.mock('../../../components/glass/GlassSurface.jsx', () => ({ default: () => null }));

let ctx;
let engine;
let made;

function makeEngine(settings = {}) {
  made = 0;
  return new AmbienceEngine({
    createContext: () => {
      made += 1;
      ctx = new FakeAudioContext();
      return ctx;
    },
    settingsPref: memoryPref(normalizeSettings(settings)),
    scenesPref: memoryPref([]),
    sessionStore: memoryPref(null),
    channel: null,
  });
}

async function run(seconds) {
  for (let i = 0; i < seconds * 4; i += 1) {
    ctx.advance(0.25);
    await vi.advanceTimersByTimeAsync(250);
  }
}

async function jump(seconds) {
  ctx.advance(seconds);
  await vi.advanceTimersByTimeAsync(250);
}

const levelGain = (layerId) => engine.current.inst.levels[layerId].gain;
const liveOscillators = () => ctx.nodes.filter((n) => n.kind === 'oscillator' && n.started !== false && !n.ended && !n.disconnected);

beforeEach(() => {
  vi.useFakeTimers();
  engine = makeEngine();
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

// ---- The catalogue ---------------------------------------------------------------------

describe('Catalogue', () => {
  it('has a world, five regions and 25 places, with unique ids and valid links', () => {
    expect(WORLD.name).toBe('The Frontier');
    expect(REGIONS).toHaveLength(5);
    expect(LOCATIONS).toHaveLength(25);
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(25);
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(5);
    for (const r of REGIONS) expect(locationsIn(r.id)).toHaveLength(5);
    for (const l of LOCATIONS) {
      expect(REGIONS.some((r) => r.id === l.regionId)).toBe(true);
      expect(locationById(l.id)).toBe(l);
      expect(TIME_IDS).toContain(l.time);
      expect(regionWeathers(l.regionId)).toContain(l.weather);
      expect(new Set(l.layers.map((x) => x.id)).size).toBe(l.layers.length);
      expect(l.layers.length).toBeLessThanOrEqual(MAX_LAYERS);
      for (const layer of l.layers) {
        expect(LAYER_KINDS).toContain(layer.kind);
        expect(layer.level).toBeGreaterThan(0);
        expect(layer.level).toBeLessThanOrEqual(0.6); // curated: nothing starts at full
      }
      for (const id of l.events) expect(EVENTS[id]).toBeTruthy();
      // An event can always find a layer of its kind here.
      for (const id of l.events) expect(EVENTS[id].layers.some((k) => l.layers.some((x) => x.kind === k))).toBe(true);
    }
  });

  it('is original: no names, places or branding from any game', () => {
    const words = JSON.stringify([WORLD, REGIONS, LOCATIONS, Object.values(EVENTS).map((e) => e.label), Object.values(MOODS).map((m) => m.label)]);
    for (const banned of [/heartland/i, /big valley/i, /grizzl/i, /new austin/i, /bayou/i, /emerald ranch/i, /rockstar/i, /red dead/i, /rdr/i, /lemoyne/i, /ambarino/i, /new hanover/i, /saint denis/i, /valentine/i, /strawberry/i, /blackwater/i, /rhodes/i, /annesburg/i, /tumbleweed/i, /armadillo/i]) {
      expect(words).not.toMatch(banned);
    }
  });

  it('makes every place a valid environment the engine can play', () => {
    expect(FRONTIER_ENVIRONMENTS).toHaveLength(25);
    for (const env of FRONTIER_ENVIRONMENTS) {
      expect(validEnvironment(env)).toBe(true);
      expect(environmentById(env.id)).toBe(env);
      expect(isFrontier(env.id)).toBe(true);
    }
    expect(isFrontier('rainy-mood')).toBe(false);
  });

  it('builds, plays and disposes every place in every time and weather without leaving nodes', () => {
    const c = new FakeAudioContext();
    const out = c.createGain();
    for (const env of FRONTIER_ENVIRONMENTS) {
      const kit = createKit({ ctx: c, out, sends: { reverb: c.createGain(), delay: c.createGain() }, buffers: new Map(), rng: seeded(7), maxVoices: env.maxVoices });
      const inst = env.create(kit, { params: { mood: 0.5, variation: 0.5, depth: 0.5 } });
      expect(Object.keys(inst.levels).sort()).toEqual(env.layers.map((l) => l.id).sort());
      inst.setMusic({ enabled: true, volume: 0.6, mood: 'campfire' }, 0.05);
      let t = 0;
      for (const time of TIME_IDS) {
        for (const weather of regionWeathers(env.frontier.regionId)) {
          inst.setConditions({ time, weather }, 0.05);
          inst.schedule(t, t + 20);
          t += 20;
          c.advance(20);
        }
      }
      inst.randomize(seeded(3));
      inst.evolve(seeded(4));
      kit.dispose();
      expect(kit.counts()).toEqual({ owned: 0, active: 0 });
    }
  });
});

describe('Catalogue: research blueprint', () => {
  const BLUEPRINT = {
    ironpeak: ['Snowline Pass', 'Glasswater Tarn', 'Whitepine Camp', 'Highwind Shelf', 'Blue Glacier Run'],
    plains: ['Golden Mile', 'Windmill Ranch', 'Redclay Crossing', 'Longhorn Meadow', 'Alder Creek'],
    lowlands: ['Darkwater Fen', 'Heron Reach', 'Cypress Bend', 'Reedlight Marsh', 'Lantern Landing'],
    valley: ['Pineglass River', 'Fernwood Basin', 'Elkshadow Grove', 'Mossfall Trail', 'Timberline Meadow'],
    desert: ['Copper Mesa', 'Dustwillow Wash', 'Suncrack Canyon', 'Coyote Flats', 'Drywell Outpost'],
  };

  it('uses the blueprint’s destinations and 25 places (Darkwater Fen, not Blackwater)', () => {
    expect(REGIONS.map((r) => r.name)).toEqual(['Goldgrass Plains', 'Pinewater Valley', 'Ironpeak Range', 'Cypress Lowlands', 'Sunscour Desert']);
    for (const [region, names] of Object.entries(BLUEPRINT)) expect(locationsIn(region).map((l) => l.name).sort()).toEqual([...names].sort());
    expect(JSON.stringify(LOCATIONS)).not.toMatch(/blackwater/i);
    expect(FUTURE_REGIONS).toEqual([{ id: 'isles', name: 'The Greenwater Isles', status: 'planned' }]);
    expect(REGIONS.some((r) => r.id === 'isles')).toBe(false);
  });

  it('gives every place its full record', () => {
    for (const l of LOCATIONS) {
      expect(l.identity.length).toBeGreaterThan(10);
      expect(Object.keys(l.character).sort()).toEqual(['vegetation', 'water', 'wind']);
      expect(l.moods.length).toBeGreaterThan(0);
      for (const m of l.moods) expect(MOOD_IDS).toContain(m);
      for (const layer of l.layers) {
        expect(validateSource(layer.source)).toEqual([]);
        expect(layer.source).toEqual({ kind: 'synth', recipe: `${layer.kind}/${layer.variant}` });
      }
    }
  });

  it('gives every destination weighted weather with dwell times', () => {
    for (const r of REGIONS) {
      const { allowed, weights, dwell } = r.weather;
      for (const w of allowed) {
        expect(WEATHER_IDS).toContain(w);
        expect(weights[w]).toBeGreaterThan(0);
      }
      expect(Object.keys(weights).sort()).toEqual([...allowed].sort());
      expect(dwell[0]).toBeGreaterThan(0);
      expect(dwell[1]).toBeGreaterThan(dwell[0]);
      // Storms are occasional: clear or partly cloudy is always likelier than a thunderstorm.
      if (weights.thunderstorm) expect(weights.clear).toBeGreaterThan(weights.thunderstorm * 4);
    }
    // Country-specific weather stays where it belongs.
    expect(REGIONS.filter((r) => r.weather.allowed.includes('snowfall')).map((r) => r.id)).toEqual(['ironpeak']);
    expect(REGIONS.filter((r) => r.weather.allowed.includes('dust-wind')).map((r) => r.id)).toEqual(['desert']);
    for (const l of LOCATIONS) expect(regionWeathers(l.regionId)).toContain(l.weather);
  });

  it('maps every place renamed before release to one current place', () => {
    const olds = Object.keys(LEGACY_LOCATION_IDS);
    const news = Object.values(LEGACY_LOCATION_IDS);
    expect(new Set(news).size).toBe(news.length);
    for (const id of news) expect(locationById(id)).toBeTruthy();
    for (const id of olds) {
      expect(LOCATIONS.some((l) => l.id === id)).toBe(false);
      expect(locationById(id).id).toBe(currentLocationId(id));
    }
  });
});

describe('Recording sources (reserved)', () => {
  const asset = {
    id: 'rain-roof', path: 'audio/rain-roof.ogg', codec: 'opus', durationSec: 60, sampleRate: 48000, channels: 2,
    licence: { type: 'CC0', reference: 'https://example.org/proof', attribution: '', usage: 'any' },
    loop: { startSec: 0.5, endSec: 59, crossfadeMs: 400 }, loudness: { lufs: -28, trimDb: -2 },
  };
  it('ships no recordings, and checks a future one’s licence and loop record', () => {
    expect(ASSETS).toEqual([]);
    expect(SOURCE_KINDS).toEqual(['synth', 'licensed-audio', 'original-music']);
    expect(validateAsset(asset)).toEqual([]);
    expect(validateAsset({ ...asset, licence: { type: 'CC0' } })).toContain('licence');
    expect(validateAsset({ ...asset, loop: { startSec: 10, endSec: 5, crossfadeMs: 0 } })).toContain('loop');
    expect(validateSource({ kind: 'licensed-audio', assetId: 'rain-roof' })).toEqual(['assetId']); // not bundled
    expect(validateSource({ kind: 'licensed-audio', assetId: 'rain-roof' }, [asset])).toEqual([]);
    expect(validateSource({ kind: 'original-music', trackId: 'x' })).toEqual([]);
    expect(validateSource({ kind: 'mp3' })).toEqual(['kind']);
  });
});

// ---- Time and weather ------------------------------------------------------------------

describe('Time and weather', () => {
  it('changes what each kind of sound does', () => {
    expect(conditionMult('birds', 'dawn', 'clear')).toBeGreaterThan(conditionMult('birds', 'night', 'clear') * 10);
    expect(conditionMult('frogs', 'night', 'clear')).toBeGreaterThan(conditionMult('frogs', 'afternoon', 'clear') * 4);
    expect(conditionMult('insects', 'night', 'snowfall')).toBe(0);
    expect(conditionMult('wind', 'afternoon', 'windy')).toBeGreaterThan(1.5);
    expect(conditionMult('birds', 'morning', 'thunderstorm')).toBeLessThan(0.1);
    expect(conditionMult('human', 'night', 'clear')).toBeLessThan(conditionMult('human', 'afternoon', 'clear'));
    expect(weatherAudible('clear')).toBe(false);
    expect(weatherAudible('light-rain')).toBe(true);
    expect(weatherNote('clear')).toMatch(/Silent/);
    expect(weatherNote('overcast')).toMatch(/distant thunder/);
    expect(weatherNote('heavy-rain')).toBeNull();
  });

  it('has Dusk, and the new weathers change the sound', () => {
    expect(TIME_IDS).toEqual(['dawn', 'morning', 'afternoon', 'dusk', 'night']);
    expect(conditionMult('birds', 'morning', 'fog')).toBeLessThan(conditionMult('birds', 'morning', 'clear'));
    expect(conditionMult('wind', 'afternoon', 'fog')).toBeLessThan(1);
    expect(conditionMult('wind', 'afternoon', 'dust-wind')).toBeGreaterThan(1.8);
    expect(conditionMult('birds', 'morning', 'partly-cloudy')).toBeGreaterThan(conditionMult('birds', 'morning', 'overcast'));
    expect(weatherAudible('dust-wind')).toBe(true);
    expect(weatherNote('fog')).toBe('Silent in fog weather');
    expect(weatherNote('partly-cloudy')).toBe('Silent in partly cloudy weather');
    // A wind chosen elsewhere is the desert's own dust wind there, and back.
    expect(weatherFor('desert', 'windy')).toBe('dust-wind');
    expect(weatherFor('plains', 'dust-wind')).toBe('windy');
    expect(weatherFor('valley', 'windy')).toBeNull();
    expect(effectiveConditions(locationById('fr-copper-mesa'), { weather: 'windy', time: 'evening' })).toMatchObject({ weather: 'dust-wind', time: 'dusk' });
  });

  it('only allows snow where it can snow, falling back to the place’s own weather', () => {
    expect(regionWeathers('ironpeak')).toContain('snowfall');
    for (const r of ['plains', 'valley', 'lowlands', 'desert']) expect(regionWeathers(r)).not.toContain('snowfall');
    const prairie = locationById('fr-golden-mile');
    expect(effectiveConditions(prairie, { time: 'night', weather: 'snowfall' })).toMatchObject({ time: 'night', weather: 'clear', source: 'set' });
    expect(effectiveConditions(prairie, {})).toMatchObject({ time: 'afternoon', weather: 'clear', source: 'default', isDefault: true });
    expect(effectiveConditions(prairie, {}, { time: 'dawn', weather: 'windy' })).toMatchObject({ time: 'dawn', weather: 'windy', source: 'dynamic' });
  });

  it('drifts slowly: one hour on at most, a neighbouring weather the region allows', () => {
    const rng = seeded(11);
    for (const r of REGIONS) {
      let c = { time: 'dawn', weather: 'clear' };
      for (let i = 0; i < 200; i += 1) {
        const next = driftStep(c, r.weather.allowed, rng, r.weather.weights);
        const step = (TIME_IDS.indexOf(next.time) - TIME_IDS.indexOf(c.time) + 5) % 5;
        expect(step).toBeLessThanOrEqual(1);
        expect(r.weather.allowed).toContain(next.weather);
        if (c.weather === 'clear') expect(next.weather).not.toBe('thunderstorm');
        c = next;
      }
    }
  });
});

// ---- Living-world events ---------------------------------------------------------------

describe('Living-world events', () => {
  const all = () => true;

  it('picks only what suits the hour, the weather and an audible layer', () => {
    const rng = seeded(5);
    for (let i = 0; i < 50; i += 1) {
      const pick = pickEvent({ pool: ['owl', 'hawk', 'coyote'], time: 'afternoon', weather: 'clear', now: 1000, audible: all, rng });
      expect(pick.id).toBe('hawk');
    }
    expect(pickEvent({ pool: ['owl'], time: 'night', weather: 'thunderstorm', now: 0, audible: all, rng })).toBeNull();
    expect(pickEvent({ pool: ['train'], time: 'night', weather: 'clear', now: 0, audible: (k) => k !== 'distant', rng })).toBeNull();
    // Into the first audible layer it can use.
    expect(pickEvent({ pool: ['hawk'], time: 'morning', weather: 'clear', now: 0, audible: (k) => k === 'birds', rng })).toMatchObject({ id: 'hawk', layer: 'birds' });
  });

  it('never repeats the last one, and waits for each one’s cooldown', () => {
    const rng = seeded(6);
    expect(pickEvent({ pool: ['gust'], time: 'night', weather: 'clear', now: 500, history: [{ id: 'gust', at: 100 }], audible: all, rng })).toBeNull();
    expect(pickEvent({ pool: ['gust', 'owl'], time: 'night', weather: 'clear', now: 130, history: [{ id: 'gust', at: 100 }, { id: 'owl', at: 120 }], audible: all, rng })).toBeNull();
    expect(pickEvent({ pool: ['gust', 'owl'], time: 'night', weather: 'clear', now: 500, history: [{ id: 'gust', at: 100 }, { id: 'owl', at: 120 }], audible: all, rng })?.id).toBe('gust');
  });

  it('plays them sparsely, one at a time, never the same twice running', () => {
    const c = new FakeAudioContext();
    const kit = createKit({ ctx: c, out: c.createGain(), sends: { reverb: c.createGain(), delay: c.createGain() }, buffers: new Map(), rng: seeded(9), maxVoices: 28 });
    const layer = (kind) => {
      const l = kit.layer(0.5);
      return [kind, { gain: l.gain, api: { gustAt() {} } }];
    };
    const director = createDirector({ kit, pool: ['hawk', 'coyote', 'gust', 'owl', 'elk'], layers: new Map(['wildlife', 'wind', 'birds'].map(layer)), rng: seeded(12) });
    director.setConditions({ time: 'dusk', weather: 'clear' }, {});
    for (let t = 0; t < 3600; t += 1) director.schedule(t, t + 1);
    // New events only: an answered call is the same call again, on purpose (frontierWorld.test.js).
    const h = director.history().filter((x) => !x.answer);
    expect(h.length).toBeGreaterThan(6);
    for (let i = 1; i < h.length; i += 1) {
      expect(h[i].id).not.toBe(h[i - 1].id);
      expect(h[i].at - h[i - 1].at).toBeGreaterThanOrEqual(10); // spaced, and never stacked
    }
    kit.dispose();
  });
});

// ---- Music -----------------------------------------------------------------------------

describe('Music', () => {
  it('follows the hour and weather on Auto', () => {
    const prairie = locationById('fr-golden-mile');
    const cabin = locationById('fr-whitepine-camp');
    expect(autoMood(prairie, { time: 'afternoon', weather: 'clear' })).toBe('long-ride');
    expect(autoMood(prairie, { time: 'night', weather: 'clear' })).toBe('night-watch');
    expect(autoMood(prairie, { time: 'morning', weather: 'thunderstorm' })).toBe('storm');
    expect(autoMood(cabin, { time: 'dusk', weather: 'overcast' })).toBe('campfire');
    expect(autoMood(locationById('fr-mossfall-trail'), { time: 'morning', weather: 'clear' })).toBe('frontier-calm');
  });

  it('writes bars that stay inside the bar and in a playable range', () => {
    const rng = seeded(21);
    for (const id of MOOD_IDS) {
      const mood = MOODS[id];
      for (const chord of mood.chords) {
        const { notes } = barNotes(mood, chord, rng);
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          expect(n.at).toBeGreaterThanOrEqual(0);
          expect(n.at).toBeLessThan(mood.beats);
          expect(n.midi).toBeGreaterThanOrEqual(33);
          expect(n.midi).toBeLessThanOrEqual(84);
        }
      }
    }
  });

  it('is off by default, plays only when on, and has its own volume', async () => {
    await engine.openLocation('fr-windmill-ranch', { play: true });
    expect(engine.state.frontier.mode).toBe('environmental');
    await run(10);
    // A pluck's second oscillator: a triangle detuned by 4 cents (voices.js), nothing else makes one.
    const plucks = () => ctx.nodes.filter((n) => n.kind === 'oscillator' && n.type === 'triangle' && n.detune.value === 4).length;
    const before = plucks();
    await run(10);
    expect(plucks()).toBe(before); // nothing musical scheduled while it's off
    engine.setMusic({ enabled: true, volume: 0.5 });
    await run(20);
    expect(plucks()).toBeGreaterThan(before);
    expect(engine.state.musicMood).toBe('campfire');
    engine.setMusic({ mood: 'night-watch' });
    expect(engine.state.musicMood).toBe('night-watch');
    expect(engine.state.frontier).toMatchObject({ mode: 'cinematic', music: { cinematicVolume: 0.5, mood: 'night-watch' } });
    engine.setMode('radio');
    engine.setMusic({ volume: 0.9 });
    expect(engine.state.frontier.music).toMatchObject({ cinematicVolume: 0.5, radioVolume: 0.9 });
    engine.setMusic({ enabled: false });
    expect(engine.state.frontier.mode).toBe('environmental');
  });
});

// ---- The engine ------------------------------------------------------------------------

describe('Engine: Frontier places', () => {
  it('plays a place on one context, and switching crossfades without leaving the old one', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    expect(made).toBe(1);
    expect(engine.state.status).toBe('playing');
    expect(engine.state.environmentId).toBe('fr-golden-mile');
    expect(engine.state.frontier).toMatchObject({ regionId: 'plains', locationId: 'fr-golden-mile' });
    await run(5);
    await engine.openLocation('fr-darkwater-fen', { play: true });
    expect(engine.diagnostics().instances).toBe(2); // crossfading
    await run(5);
    expect(engine.diagnostics().instances).toBe(1);
    expect(engine.state.frontier).toMatchObject({ regionId: 'lowlands', locationId: 'fr-darkwater-fen' });
    for (let i = 0; i < 10; i += 1) engine.openLocation(LOCATIONS[i].id);
    await run(5);
    expect(engine.diagnostics().instances).toBe(1);
    expect(made).toBe(1);
    engine.stop();
    await run(2);
    expect(engine.diagnostics()).toMatchObject({ instances: 0, nodes: 0, voices: 0, ticking: false });
  });

  it('applies time and weather to the playing place, and resets to its own', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    expect(engine.state.conditions).toMatchObject({ time: 'afternoon', weather: 'clear', isDefault: true });
    engine.setConditions({ time: 'night', weather: 'thunderstorm' });
    expect(engine.state.conditions).toMatchObject({ time: 'night', weather: 'thunderstorm', source: 'set' });
    expect(engine.diagnostics().frontier.conditions).toEqual({ time: 'night', weather: 'thunderstorm' });
    expect(engine.state.musicMood).toBe('storm');
    engine.setConditions({ weather: 'snowfall' }); // not on the plains
    expect(engine.state.conditions.weather).toBe('clear');
    engine.resetConditions();
    expect(engine.state.frontier).toMatchObject({ time: null, weather: null });
    expect(engine.state.conditions).toMatchObject({ time: 'afternoon', weather: 'clear', isDefault: true });
  });

  it('mutes a layer and keeps its level; moving its slider brings it back', async () => {
    await engine.openLocation('fr-pineglass-river', { play: true });
    const before = engine.state.layers.water;
    engine.setLayerMuted('water', true);
    expect(engine.state.muted.water).toBe(true);
    expect(engine.state.layers.water).toBe(before);
    expect(levelGain('water').target).toBe(0);
    engine.setLayerMuted('water', false);
    expect(engine.state.muted.water).toBeUndefined();
    engine.setLayerMuted('water', true);
    engine.setLayerVolume('water', 0.3);
    expect(engine.state.muted.water).toBeUndefined();
    expect(engine.state.layers.water).toBe(0.3);
  });

  it('a muted layer stays silent when the place is played again later', async () => {
    await engine.openLocation('fr-pineglass-river', { play: true });
    engine.setLayerMuted('birds', true);
    engine.stop();
    await run(2);
    await engine.play();
    expect(levelGain('birds').value).toBe(0);
  });

  it('Dynamic Atmosphere moves the conditions on slowly while playing, and never while paused', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.setDynamicAtmosphere(true);
    await run(1);
    expect(engine.state.conditions.source).toBe('dynamic');
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) {
      await jump(120);
      seen.add(`${engine.state.conditions.time}/${engine.state.conditions.weather}`);
    }
    expect(seen.size).toBeGreaterThan(2);
    for (const k of seen) expect(regionWeathers('plains')).toContain(k.split('/')[1]);
    engine.pause();
    const frozen = { ...engine.state.conditions };
    for (let i = 0; i < 20; i += 1) await jump(600);
    expect(engine.state.conditions).toMatchObject({ time: frozen.time, weather: frozen.weather });
    engine.setDynamicAtmosphere(false);
    expect(engine.state.conditions.source).not.toBe('dynamic');
  });

  it('Next goes to the next place in the same region', () => {
    expect(nextEnvironmentId('fr-golden-mile')).toBe('fr-windmill-ranch');
    expect(nextEnvironmentId('fr-alder-creek')).toBe('fr-golden-mile');
    expect(nextEnvironmentId('dreamscape')).toBe('rainy-mood');
  });

  it('saves a scene with the place’s chosen time and weather, and applies it', async () => {
    await engine.openLocation('fr-reedlight-marsh', { play: true });
    engine.setConditions({ time: 'dawn', weather: 'light-rain' });
    const scene = engine.saveScene('Rainy reeds');
    expect(scene.conditions).toEqual({ time: 'dawn', weather: 'light-rain' });
    engine.resetConditions();
    await engine.openLocation('fr-copper-mesa');
    engine.applyScene(scene);
    expect(engine.state.environmentId).toBe('fr-reedlight-marsh');
    expect(engine.state.conditions).toMatchObject({ time: 'dawn', weather: 'light-rain' });
    // Not a Frontier place: no conditions kept.
    expect(normalizeScene({ name: 'x', environmentId: 'forest', conditions: { time: 'dawn' } }).conditions).toBeNull();
  });

  it('pauses events and music with everything else: nothing is scheduled while paused', async () => {
    await engine.openLocation('fr-darkwater-fen', { play: true });
    engine.setMusic({ enabled: true });
    await run(10);
    engine.pause();
    await run(1);
    const count = ctx.nodes.length;
    await run(30);
    expect(ctx.nodes.length).toBe(count);
    expect(engine.diagnostics().ticking).toBe(false);
  });
});

// ---- Persistence -----------------------------------------------------------------------

const DEFAULT_FRONTIER = {
  regionId: 'plains', locationId: 'fr-golden-mile', mode: 'environmental',
  time: null, timeMode: 'fixed', speed: 6, weather: null, weatherMode: 'locked', weatherIntensity: 0.5,
  eventIntensity: 0.5, ambienceVolume: 1, music: { mood: 'auto', cinematicVolume: 0.45, radioVolume: 0.75 },
};

describe('Settings v4', () => {
  it('carries v2 settings over and adds Frontier defaults', () => {
    const v2 = normalizeSettings({ v: 2, environmentId: 'forest', masterVolume: 0.4, environments: { forest: { layers: { birds: 0.9 } } }, evolution: 'organic' });
    expect(v2).toMatchObject({ v: 4, environmentId: 'forest', masterVolume: 0.4, evolution: 'organic' });
    expect(v2.environments.forest.layers.birds).toBe(0.9);
    expect(v2.environments.forest.muted).toEqual({});
    expect(v2.frontier).toEqual(DEFAULT_FRONTIER);
    expect(v2.environments['fr-darkwater-fen'].layers.frogs).toBe(0.5);
  });

  it('repairs damaged Frontier settings', () => {
    const s = normalizeSettings({
      environmentId: 'fr-nowhere',
      environments: { 'fr-golden-mile': { layers: { wind: 7 }, muted: { wind: 'yes', grass: true, ghost: true } } },
      frontier: {
        regionId: 'atlantis', locationId: 'fr-glasswater-tarn', mode: 'opera', time: 'teatime', timeMode: 'yesterday', speed: 7,
        weather: 'snowfall', weatherMode: 'hail', weatherIntensity: 4, eventIntensity: -1, ambienceVolume: 'loud',
        music: { mood: 'disco', cinematicVolume: -3, radioVolume: null },
      },
    });
    expect(s.environmentId).toBe('rainy-mood');
    expect(s.environments['fr-golden-mile'].layers.wind).toBe(1);
    expect(s.environments['fr-golden-mile'].muted).toEqual({ grass: true });
    expect(s.frontier).toEqual({
      ...DEFAULT_FRONTIER, regionId: 'ironpeak', locationId: 'fr-glasswater-tarn', weather: 'snowfall',
      weatherIntensity: 1, eventIntensity: 0, music: { mood: 'auto', cinematicVolume: 0, radioVolume: 0.75 },
    });
  });

  it('keeps everything a reload needs, and never plays after one', async () => {
    const pref = memoryPref(normalizeSettings({}));
    const a = new AmbienceEngine({ createContext: () => new FakeAudioContext(), settingsPref: pref, scenesPref: memoryPref([]), sessionStore: memoryPref(null), channel: null });
    await a.openLocation('fr-fernwood-basin');
    a.setConditions({ time: 'dusk', weather: 'light-rain' });
    a.setLayerMuted('birds', true);
    a.setMusic({ enabled: true, volume: 0.7, mood: 'wilderness' });
    a.setDynamicAtmosphere(true);
    a.dispose();
    let contexts = 0;
    const b = new AmbienceEngine({ createContext: () => { contexts += 1; return new FakeAudioContext(); }, settingsPref: memoryPref(normalizeSettings(JSON.parse(JSON.stringify(pref.get())))), scenesPref: memoryPref([]), sessionStore: memoryPref(null), channel: null });
    expect(b.state).toMatchObject({ status: 'idle', environmentId: 'fr-fernwood-basin' });
    expect(b.state.frontier).toMatchObject({ time: 'dusk', weather: 'light-rain', timeMode: 'accelerated', weatherMode: 'simulated', mode: 'cinematic', music: { cinematicVolume: 0.7, mood: 'wilderness' } });
    expect(b.state.muted.birds).toBe(true);
    expect(contexts).toBe(0);
    b.dispose();
  });

  it('migrates version 3: Dynamic Atmosphere, music on, Evening, and places renamed before release', () => {
    const v3 = normalizeSettings({
      v: 3,
      environmentId: 'fr-cypress-swamp',
      environments: { 'fr-cypress-swamp': { layers: { frogs: 0.2 }, muted: { birds: true } }, 'fr-quiet-ranch': { layers: { fire: 0.9 } } },
      frontier: { regionId: 'lowlands', locationId: 'fr-cypress-swamp', time: 'evening', weather: 'fog', dynamic: true, music: { enabled: true, volume: 0.3, mood: 'campfire' } },
    });
    expect(v3.environmentId).toBe('fr-darkwater-fen');
    expect(v3.environments['fr-darkwater-fen'].layers.frogs).toBe(0.2);
    expect(v3.environments['fr-darkwater-fen'].muted).toEqual({ birds: true });
    expect(v3.environments['fr-windmill-ranch'].layers.fire).toBe(0.9);
    expect(v3.environments['fr-cypress-swamp']).toBeUndefined();
    expect(v3.frontier).toMatchObject({
      locationId: 'fr-darkwater-fen', time: 'dusk', weather: 'fog', timeMode: 'accelerated', weatherMode: 'simulated',
      mode: 'cinematic', music: { mood: 'campfire', cinematicVolume: 0.3, radioVolume: 0.75 },
    });
    // Off in v3: held, and ambience only.
    const off = normalizeSettings({ v: 3, frontier: { dynamic: false, music: { enabled: false, volume: 0.6 } } });
    expect(off.frontier).toMatchObject({ timeMode: 'fixed', weatherMode: 'locked', mode: 'environmental', music: { cinematicVolume: 0.6 } });
  });

  it('migrates scenes saved at a renamed place or at Evening', () => {
    const scene = normalizeScene({ name: 'Old swamp', environmentId: 'fr-cypress-swamp', layers: { frogs: 0.3 }, conditions: { time: 'evening', weather: 'light-rain' } });
    expect(scene).toMatchObject({ environmentId: 'fr-darkwater-fen', conditions: { time: 'dusk', weather: 'light-rain' } });
    expect(scene.layers.frogs).toBe(0.3);
  });
});

// ---- What's on screen ------------------------------------------------------------------

describe('Frontier World window, Atmosphere tab and island', () => {
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const win = (props = {}) => renderToStaticMarkup(createElement(FrontierWindow, { open: true, setOpen: () => {}, ...props }));

  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
    _resetAmbience();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _resetAmbience();
    vi.unstubAllGlobals();
  });

  it('the Atmosphere tab is the way in: open the window, or listen to the last place', () => {
    const html = renderToStaticMarkup(createElement(FrontierWorld, { state: getAmbience().getState(), ids: 't' }));
    const t = text(html);
    expect(t).toContain('Open Frontier World');
    expect(t).toContain('Listen to Golden Mile');
    expect(t).toContain('Last visited: Golden Mile');
    for (const r of REGIONS) expect(t).toContain(r.name);
    expect(html).toContain('<svg class="frontier-scenery');
    expect(t).not.toContain('Time &amp; Weather'); // the controls live in the window now
  });

  it('the window has places, the scene, the controls and a Now Playing strip', () => {
    const eng = getAmbience();
    eng.changeEnvironment('fr-darkwater-fen');
    const html = win();
    const t = text(html);
    expect(html).toContain('aria-label="Destinations and places"');
    expect(html).toContain('aria-label="Frontier controls"');
    expect(html).toContain('aria-label="Now playing"');
    // Places: its destination open, the place current.
    expect(html).toMatch(/aria-current="true"[^>]*>.*Darkwater Fen/);
    for (const r of REGIONS) expect(t).toContain(r.name);
    // Scene.
    expect(t).toContain('Black water under the cypress');
    expect(t).toContain('Water: still black water');
    // Controls: experience, time, weather (the lowlands' own), intensities, layers.
    for (const label of ['Environmental', 'Cinematic', 'Frontier Radio', 'Fixed', 'Real Time', 'Accelerated', 'Locked', 'Simulated']) expect(t).toContain(label);
    for (const w of ['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Heavy Rain', 'Thunderstorm', 'Fog']) expect(t).toContain(w);
    expect(t).not.toContain('Snowfall');
    expect(t).not.toContain('Dust Wind');
    for (const label of ['Events', 'Weather', 'Ambience', 'Music volume']) expect(html).toContain(`<span class="atm-slider-label">${label}</span>`);
    expect(html).toContain('aria-label="Mute Frogs"');
    expect(t).toContain('Silent in clear weather');
    expect(t).toContain('an owl');
    // Music is off in Environmental: its controls say so and are disabled.
    expect(t).toContain('Music plays in Cinematic and Frontier Radio.');
    expect(html).toMatch(/<select[^>]*aria-label="Music mood"[^>]*disabled/);
    // Narrow windows: the sheets' buttons are there (shown by the container query).
    expect(html).toContain('aria-expanded="false">Places</button>');
    expect(html).toContain('aria-expanded="false">Controls</button>');
  });

  it('shows the clock and the speed while time is accelerated, and an approaching front', () => {
    const eng = getAmbience();
    eng.changeEnvironment('fr-golden-mile');
    eng.setTimeMode('accelerated');
    eng.setSpeed(12);
    const state = { ...eng.getState(), status: 'playing', session: true, conditions: { ...eng.getState().conditions, clock: 6 * 60 + 42, time: 'dawn', front: 'light-rain' } };
    vi.spyOn(eng, 'getState').mockReturnValue(state);
    const t = text(win());
    expect(t).toContain('6:42');
    expect(t).toContain('12×');
    expect(t).toContain('A day in 2 hours');
    expect(t).toContain('Light Rain on its way');
  });

  it('offers to listen when the place shown isn’t the one playing', () => {
    const eng = getAmbience();
    eng.openLocation('fr-golden-mile');
    eng.changeEnvironment('rainy-mood'); // a classic environment: Golden Mile is the last place visited
    const t = text(win());
    expect(t).toContain('Listen to Golden Mile');
    expect(t).toContain('Listen to Golden Mile to mix its layers.');
  });

  it('the island shows the place, the weather icon, and the experience mode', () => {
    const eng = getAmbience();
    eng.changeEnvironment('fr-glasswater-tarn');
    eng.setMode('radio');
    const state = { ...eng.getState(), status: 'playing', session: true };
    const html = renderToStaticMarkup(createElement(AmbienceIsland, { state, expanded: true }));
    const t = text(html);
    expect(t).toContain('Glasswater Tarn');
    expect(t).toContain('Ironpeak Range · Night, clear');
    expect(html).toContain('island-weather');
    expect(html).toContain('aria-label="Experience: Radio. Change to Ambience"');
    expect(html).toContain('aria-label="Next place in this region"');
  });
});

it('every mood id is valid for settings', () => {
  for (const id of MOOD_IDS) expect(normalizeSettings({ frontier: { music: { mood: id } } }).frontier.music.mood).toBe(id);
  expect(WEATHER_IDS).toHaveLength(10);
  expect(liveOscillators).toBeTypeOf('function');
});
