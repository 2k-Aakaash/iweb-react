// Atmosphere 2.0: Living Atmosphere (evolution), scenes, the stereo image, focus sessions, the
// meter, persistence and suggestions. The audio clock is the fake's (fakeAudio.js); `jump`
// moves it on by minutes at a time, as a long-running session would.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbienceEngine, volumeGain } from '../engine.js';
import { ENVIRONMENTS, environmentById } from '../environments/index.js';
import { evolutionStep, profileOf, startLevels, effectiveParams } from '../evolution.js';
import { BUILT_IN_SCENES, normalizeScene, normalizeScenes } from '../scenes.js';
import { normalizeSettings } from '../prefs.js';
import { seeded } from '../random.js';
import {
  msToNextSlot, sceneForWords, startSuggestions, timeSlot, timeSuggestion, wallpaperKey, wallpaperSuggestion, wallpaperWords,
} from '../suggestions.js';
import { FakeAudioContext, memoryPref } from './fakeAudio.js';

let ctx;
let engine;
let made;
let events;
let session;

function makeEngine(options = {}) {
  made = 0;
  events = [];
  return new AmbienceEngine({
    createContext: () => {
      made += 1;
      ctx = new FakeAudioContext();
      return ctx;
    },
    settingsPref: memoryPref(normalizeSettings(options.settings || {})),
    scenesPref: memoryPref(options.scenes || []),
    sessionStore: session,
    channel: null,
    onEvent: (e) => events.push(e),
    ...options.engine,
  });
}

/** Moves the audio clock and the timers on together, a tick at a time. */
async function run(seconds) {
  for (let i = 0; i < seconds * 4; i += 1) {
    ctx.advance(0.25);
    await vi.advanceTimersByTimeAsync(250);
  }
}

/** Jumps the audio clock by `seconds` and lets one tick run (a long session, quickly). */
async function jump(seconds) {
  ctx.advance(seconds);
  await vi.advanceTimersByTimeAsync(250);
}

const evoGain = (layerId) => engine.current.kit.layerOf(engine.current.inst.levels[layerId]).evo.gain;
const levelGain = (layerId) => engine.current.inst.levels[layerId].gain;
const panOf = (layerId) => engine.current.kit.layerOf(engine.current.inst.levels[layerId]).panner.pan;

beforeEach(() => {
  vi.useFakeTimers();
  session = memoryPref(null);
  engine = makeEngine();
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

// ---- Living Atmosphere -------------------------------------------------------------------

describe('Living Atmosphere', () => {
  it('Off keeps the sound as set: no steps, every evolution gain at 1, no parameter drift', async () => {
    engine.setEvolution('off');
    await engine.play();
    for (let i = 0; i < 12; i += 1) await jump(60);
    const d = engine.diagnostics();
    expect(d.evolution.steps).toBe(0);
    expect(Object.values(d.evolution.mults).every((m) => m === 1)).toBe(true);
    expect(Object.values(d.evolution.offsets).every((o) => o === 0)).toBe(true);
    for (const layer of environmentById('rainy-mood').layers) {
      expect(evoGain(layer.id).events.filter((e) => e[0] === 'target')).toHaveLength(0);
    }
  });

  it('Gentle, Dynamic and Organic step minutes apart, a bounded number of ramps each', async () => {
    const counts = {};
    for (const mode of ['gentle', 'dynamic', 'organic']) {
      engine.dispose();
      engine = makeEngine({ settings: { evolution: mode } });
      await engine.play();
      for (let i = 0; i < 40; i += 1) await jump(30); // 20 minutes
      const steps = engine.diagnostics().evolution.steps;
      counts[mode] = steps;
      // Each step is one ramp per layer, nothing more: the automation never piles up.
      for (const layer of environmentById('rainy-mood').layers) {
        expect(evoGain(layer.id).events.filter((e) => e[0] === 'target').length).toBeLessThanOrEqual(steps);
      }
      expect(engine.diagnostics().voices).toBeLessThan(40);
    }
    expect(counts.gentle).toBeGreaterThanOrEqual(4);
    expect(counts.gentle).toBeLessThanOrEqual(12);
    expect(counts.dynamic).toBeGreaterThan(counts.gentle);
    expect(counts.organic).toBeGreaterThanOrEqual(5);
  });

  it('stops evolving while paused or stopped, and builds no backlog', async () => {
    await engine.play();
    await jump(200);
    const steps = engine.diagnostics().evolution.steps;
    engine.pause();
    await jump(3000);
    expect(engine.diagnostics().evolution.steps).toBe(steps);
    await engine.resume();
    await jump(1);
    // At most one step on resuming, however long it was paused.
    expect(engine.diagnostics().evolution.steps - steps).toBeLessThanOrEqual(1);
  });

  it('never touches the user’s layer levels or master volume', async () => {
    engine.setEvolution('dynamic');
    await engine.play();
    engine.setMasterVolume(0.4);
    engine.setLayerVolume('wind', 0.1);
    const master = engine.graph.master.gain.events.length;
    const wind = levelGain('wind').events.length;
    for (let i = 0; i < 20; i += 1) await jump(30);
    expect(engine.diagnostics().evolution.steps).toBeGreaterThan(2);
    expect(engine.graph.master.gain.events.length).toBe(master);
    expect(levelGain('wind').events.length).toBe(wind);
    expect(levelGain('wind').target).toBeCloseTo(0.1 * 0.6);
    expect(engine.getState()).toMatchObject({ masterVolume: 0.4, layers: { wind: 0.1 } });
  });

  it('keeps every step within each layer’s range and the mix no louder overall', () => {
    for (const env of ENVIRONMENTS) {
      const profile = profileOf(env);
      const rng = seeded(42);
      let current = startLevels(profile, 'organic');
      const levels = Object.fromEntries(env.layers.map((l) => [l.id, l.level * l.scale]));
      const base = Object.values(levels).reduce((a, b) => a + b, 0);
      for (let i = 0; i < 200; i += 1) {
        const step = evolutionStep({ profile, mode: i % 3 === 0 ? 'dynamic' : 'organic', rng, current, levels });
        for (const [id, t] of Object.entries(step.targets)) {
          expect(t).toBeGreaterThanOrEqual(profile.layers[id].range[0] - 1e-9);
          expect(t).toBeLessThanOrEqual(profile.layers[id].range[1] + 1e-9);
        }
        const total = Object.entries(step.targets).reduce((n, [id, t]) => n + levels[id] * t, 0);
        expect(total / base).toBeLessThanOrEqual(1.0801);
        for (const o of Object.values(step.offsets)) expect(Math.abs(o)).toBeLessThanOrEqual(0.3);
        expect(step.wait).toBeGreaterThanOrEqual(25);
        current = step.targets;
      }
    }
  });

  it('is repeatable from a seed', () => {
    const profile = profileOf(environmentById('deep-space'));
    const a = evolutionStep({ profile, mode: 'gentle', rng: seeded(7), current: startLevels(profile, 'gentle') });
    const b = evolutionStep({ profile, mode: 'gentle', rng: seeded(7), current: startLevels(profile, 'gentle') });
    expect(a).toEqual(b);
  });

  it('opens Dreamscape on pads, with the piano arriving later', async () => {
    engine.changeEnvironment('dreamscape');
    await engine.play();
    expect(evoGain('piano').value).toBeCloseTo(0.15);
    expect(evoGain('pads').value).toBe(1);
    engine.setEvolution('off');
    expect(evoGain('piano').target).toBe(1); // back to the mix as set
  });

  it('keeps the parameters’ drift small and in range', () => {
    expect(effectiveParams({ mood: 0.95, variation: 0.5, depth: 0.02 }, { mood: 0.2, variation: -0.1, depth: -0.1 }))
      .toEqual({ mood: 1, variation: 0.4, depth: 0 });
  });

  it('randomize and evolution don’t fight: a shuffle defers the next step', async () => {
    await engine.play();
    await jump(10);
    engine.randomize();
    const next = engine.diagnostics().evolution.nextAt;
    expect(next - ctx.currentTime).toBeGreaterThanOrEqual(19.9);
    expect(made).toBe(1);
  });
});

// ---- Scenes -------------------------------------------------------------------------------

describe('Scenes', () => {
  it('has the curated scenes, each valid for its environment', () => {
    const ids = BUILT_IN_SCENES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['deep-focus', 'midnight-coding', 'rainy-reading', 'forest-escape', 'ocean-meditation', 'late-night']));
    for (const s of BUILT_IN_SCENES) {
      const env = environmentById(s.environmentId);
      expect(Object.keys(s.layers).sort()).toEqual(env.layers.map((l) => l.id).sort());
      expect(s.version).toBe(2);
      expect(s.builtIn).toBe(true);
    }
  });

  it('applies a scene in the same environment smoothly: no new context, no new instance, volume kept', async () => {
    engine.changeEnvironment('deep-space');
    await engine.play();
    engine.setMasterVolume(0.33);
    const instance = engine.current;
    await engine.applyScene('deep-focus');
    expect(made).toBe(1);
    expect(engine.current).toBe(instance);
    const scene = BUILT_IN_SCENES.find((s) => s.id === 'deep-focus');
    const pads = levelGain('pads').events.at(-1);
    expect(pads[0]).toBe('target');
    expect(pads[1]).toBeCloseTo(scene.layers.pads * 0.9);
    expect(pads[3]).toBeGreaterThanOrEqual(1); // a slow glide, not a jump
    expect(engine.getState()).toMatchObject({ sceneId: 'deep-focus', masterVolume: 0.33, evolution: 'gentle', sceneModified: false });
    expect(engine.getState().params.mood).toBeCloseTo(scene.parameters.mood);
  });

  it('crossfades into a scene in another environment and leaves nothing behind', async () => {
    await engine.play();
    const one = engine.diagnostics().nodes;
    for (let i = 0; i < 3; i += 1) for (const s of BUILT_IN_SCENES) await engine.applyScene(s.id);
    expect(engine.diagnostics().instances).toBeLessThanOrEqual(3);
    await run(4);
    expect(engine.diagnostics().instances).toBe(1);
    expect(engine.diagnostics().nodes).toBeLessThan(one * 3);
    expect(made).toBe(1);
  });

  it('applies a scene while stopped without playing, and plays only when asked', async () => {
    await engine.applyScene('ocean-meditation');
    expect(made).toBe(0);
    expect(engine.getState()).toMatchObject({ status: 'idle', environmentId: 'ocean', sceneId: 'ocean-meditation' });
    await engine.applyScene('fireside', { play: true });
    expect(engine.getState()).toMatchObject({ status: 'playing', environmentId: 'fireplace' });
  });

  it('marks a scene edited, and forgets it on another environment', async () => {
    await engine.applyScene('rainy-reading');
    engine.setLayerVolume('piano', 0.9);
    expect(engine.getState()).toMatchObject({ sceneId: 'rainy-reading', sceneModified: true });
    engine.changeEnvironment('forest');
    expect(engine.getState().sceneId).toBeNull();
  });

  it('saves, applies, renames and deletes the user’s scenes', async () => {
    await engine.play();
    engine.setParameter('mood', 0.9);
    engine.setEvolution('organic');
    engine.setSpatial({ width: 0.2 });
    const scene = engine.saveScene('Night Rain');
    expect(scene).toMatchObject({ name: 'Night Rain', environmentId: 'rainy-mood', parameters: { mood: 0.9, evolutionMode: 'organic', spatialWidth: 0.2 } });
    expect(engine.getState().sceneId).toBe(scene.id);
    engine.setParameter('mood', 0.1);
    await engine.applyScene(scene.id);
    expect(engine.getState().params.mood).toBe(0.9);
    expect(engine.renameScene(scene.id, '  Late Rain ')).toBe(true);
    expect(engine.customScenes()[0].name).toBe('Late Rain');
    engine.toggleFavorite(scene.id);
    expect(engine.getState().favorites).toEqual([scene.id]);
    engine.deleteScene(scene.id);
    expect(engine.customScenes()).toEqual([]);
    expect(engine.getState().favorites).toEqual([]);
    expect(engine.getState().sceneId).toBeNull();
  });

  it('validates scene data: damaged records are dropped, built-in ids can’t be taken', () => {
    const list = normalizeScenes([
      { name: 'OK', environmentId: 'forest', parameters: { mood: 7, evolutionMode: 'wild' }, layers: { birds: -1 } },
      { name: '', environmentId: 'forest' },
      { name: 'Mars', environmentId: 'mars' },
      { id: 'deep-focus', name: 'Mine', environmentId: 'forest' },
      'junk',
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].parameters).toMatchObject({ mood: 1, evolutionMode: 'gentle' });
    expect(list[0].layers.birds).toBe(0);
    expect(normalizeScenes('junk')).toBeNull();
    expect(normalizeScene({ name: 'x', environmentId: 'ocean', seed: -4 }).seed).toBeNull();
  });
});

// ---- Stereo ------------------------------------------------------------------------------

describe('Stereo image', () => {
  it('places layers within bounds, and Width 0 is centred and still', async () => {
    engine.changeEnvironment('deep-space');
    await engine.play();
    engine.setSpatial({ width: 1, movement: 1 });
    const rec = engine.current.kit.layerOf(engine.current.inst.levels.texture);
    expect(Math.abs(panOf('texture').target)).toBeLessThanOrEqual(0.85);
    // Centre plus drift never past the edge.
    expect(Math.abs(panOf('texture').target) + rec.drift.depth.gain.target).toBeLessThanOrEqual(0.9 + 1e-9);
    engine.setSpatial({ width: 0, movement: 0 });
    for (const layer of environmentById('deep-space').layers) expect(panOf(layer.id).target).toBe(0);
    expect(rec.drift.depth.gain.target).toBe(0);
    expect(engine.getState().spatial).toEqual({ width: 0, movement: 0 });
  });

  it('clamps nonsense, and spreads events only when there is width', async () => {
    engine.setSpatial({ width: 7, movement: -2 });
    expect(engine.getState().spatial).toEqual({ width: 1, movement: 0 });
    engine.setSpatial({ width: 0 });
    await engine.play();
    const before = ctx.nodes.filter((n) => n.kind === 'panner').length;
    await run(3); // raindrops
    expect(ctx.nodes.filter((n) => n.kind === 'panner').length).toBe(before);
    engine.setSpatial({ width: 0.8 });
    await run(3);
    expect(ctx.nodes.filter((n) => n.kind === 'panner').length).toBeGreaterThan(before);
  });

  it('adds one panner per layer, no more (events get theirs only with width)', async () => {
    engine.setSpatial({ width: 0 });
    await engine.play();
    const panners = ctx.nodes.filter((n) => n.kind === 'panner').length;
    expect(panners).toBe(environmentById('rainy-mood').layers.length);
  });
});

// ---- Focus sessions ----------------------------------------------------------------------

describe('Focus sessions', () => {
  it('plays, counts down, fades near the end and stops', async () => {
    await engine.startFocus(25);
    expect(engine.getState()).toMatchObject({ status: 'playing', focus: { status: 'running', totalMs: 25 * 60000 } });
    await vi.advanceTimersByTimeAsync(10 * 60000);
    expect(engine.focusRemaining()).toBe(15 * 60000);
    await vi.advanceTimersByTimeAsync(14 * 60000 + 1000);
    const fade = engine.graph.fade.gain.events.at(-1);
    expect(fade[0]).toBe('linear');
    expect(fade[1]).toBeLessThan(0.001);
    await vi.advanceTimersByTimeAsync(60000);
    expect(engine.getState()).toMatchObject({ status: 'idle', focus: null });
    expect(events).toEqual([expect.objectContaining({ type: 'focus-complete', minutes: 25 })]);
    expect(session.get()).toBeNull();
  });

  it('pauses with the sound, resumes with it, extends and cancels', async () => {
    await engine.startFocus(30);
    await vi.advanceTimersByTimeAsync(5 * 60000);
    engine.pause();
    expect(engine.getState().focus).toMatchObject({ status: 'paused', remainingMs: 25 * 60000 });
    await vi.advanceTimersByTimeAsync(60 * 60000); // paused: no time passes for the session
    expect(engine.getState().status).toBe('paused');
    await engine.resume();
    expect(engine.getState().focus.status).toBe('running');
    engine.extendFocus(10);
    expect(engine.focusRemaining()).toBe(35 * 60000);
    engine.cancelFocus();
    expect(engine.getState()).toMatchObject({ focus: null, status: 'playing' });
    expect(engine.diagnostics().focusTimers).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(engine.getState().status).toBe('playing'); // nothing left to stop it
  });

  it('can pause at the end instead of stopping', async () => {
    engine.setFocusEnd('pause');
    await engine.startFocus(5);
    await vi.advanceTimersByTimeAsync(5 * 60000 + 100);
    expect(engine.getState()).toMatchObject({ status: 'paused', focus: null });
  });

  it('is restored after a reload as paused, with the time that was left, never playing', async () => {
    await engine.startFocus(45);
    await vi.advanceTimersByTimeAsync(15 * 60000);
    engine.persistFocus(); // what the page does as it closes
    engine.dispose();
    engine = makeEngine();
    expect(engine.getState()).toMatchObject({ status: 'idle', focus: { status: 'paused', remainingMs: 30 * 60000, restored: true } });
    expect(made).toBe(0);
    await engine.resume();
    expect(engine.getState().focus.status).toBe('running');
  });

  it('ignores a stale or damaged saved session', () => {
    engine.dispose();
    session = memoryPref({ totalMs: 'x', remainingMs: 5 });
    engine = makeEngine();
    expect(engine.getState().focus).toBeNull();
    engine.dispose();
    session = memoryPref({ totalMs: 60000 * 30, remainingMs: 60000 * 10, savedAt: Date.now() - 13 * 3600000 });
    engine = makeEngine();
    expect(engine.getState().focus).toBeNull();
  });

  it('rejects impossible lengths', async () => {
    expect(await engine.startFocus(2)).toBe(false);
    expect(await engine.startFocus(1000)).toBe(false);
    expect(engine.getState().focus).toBeNull();
  });
});

// ---- The meter ---------------------------------------------------------------------------

describe('The meter', () => {
  it('reads real levels while playing, nothing otherwise, and leaves the graph when released', async () => {
    expect(engine.meter()).toBeNull();
    await engine.play();
    const m = engine.meter();
    expect(m.bands).toHaveLength(5);
    for (const b of m.bands) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    expect(m.bands[0]).toBeGreaterThan(m.bands[4]); // the fake's falling spectrum
    const analyser = engine.graph.analyser;
    engine.meter();
    expect(engine.graph.analyser).toBe(analyser); // one analyser, reused
    engine.releaseMeter();
    expect(engine.graph.analyser).toBeNull();
    engine.pause();
    expect(engine.meter()).toBeNull();
  });
});

// ---- Persistence -------------------------------------------------------------------------

describe('Settings v2', () => {
  it('migrates Atmosphere 1 settings, keeping everything that was set', () => {
    const v1 = {
      environmentId: 'ocean',
      masterVolume: 0.3,
      environments: { ocean: { layers: { waves: 0.9 }, params: { mood: 0.8 } } },
      glow: { enabled: false, reactive: true },
      sleepMinutes: 30,
    };
    const v2 = normalizeSettings(v1);
    expect(v2).toMatchObject({
      v: 2,
      environmentId: 'ocean',
      masterVolume: 0.3,
      glow: { enabled: false, reactive: true },
      sleepMinutes: 30,
      evolution: 'gentle',
      spatial: { width: 0.6, movement: 0.35 },
      visualizer: true,
      favorites: [],
      suggest: { wallpaper: true, time: false },
      links: {},
      focus: { minutes: 25, end: 'stop' },
    });
    expect(v2.environments.ocean.layers.waves).toBe(0.9);
    expect(v2.environments.ocean.params.mood).toBe(0.8);
  });

  it('repairs damaged v2 values', () => {
    const s = normalizeSettings({
      evolution: 'chaos', spatial: { width: 'x', movement: 4 }, favorites: ['ok', 3, 'ok', 'NO SPACES'],
      links: { 'local:12': 'forest-escape', 'ftp:x': 'deep-focus', 'unsplash:abc': 'bad id!' }, focus: { minutes: 3, end: 'explode' },
      sceneId: '../etc', visualizer: 'yes',
    });
    expect(s).toMatchObject({
      evolution: 'gentle', spatial: { width: 0.6, movement: 1 }, favorites: ['ok'], links: { 'local:12': 'forest-escape' },
      focus: { minutes: 25, end: 'stop' }, sceneId: null, visualizer: true,
    });
  });

  it('never autoplays: a restored engine has no context and is idle', () => {
    engine.dispose();
    engine = makeEngine({ settings: { sceneId: 'deep-focus', environmentId: 'deep-space' } });
    expect(engine.getState()).toMatchObject({ status: 'idle', sceneId: 'deep-focus' });
    expect(made).toBe(0);
  });
});

// ---- Suggestions -------------------------------------------------------------------------

describe('Suggestions', () => {
  const log = () => {
    const seen = new Set();
    return { has: (k) => seen.has(k), add: (k) => seen.add(k) };
  };
  const base = { status: 'idle', session: false, sceneId: null, suggest: { wallpaper: true, time: true }, links: {}, focus: null };

  it('matches a scene from a wallpaper’s own words', () => {
    expect(sceneForWords(wallpaperWords({ topic: 'nature', description: 'Misty pine forest at dawn', keywords: ['trees'] }))).toBe('forest-escape');
    expect(sceneForWords(wallpaperWords({ description: 'Rainy city street at night' }))).toBe('rainy-reading');
    expect(sceneForWords(wallpaperWords({ name: 'IMG_2041.jpg' }))).toBeNull();
    expect(sceneForWords(wallpaperWords({ name: 'beach-waves.png' }))).toBe('ocean-meditation');
    expect(wallpaperKey({ source: 'local', id: 12 })).toBe('local:12');
    expect(wallpaperKey(null)).toBeNull();
  });

  it('prefers the user’s link, suggests each pair once, and only suggests', async () => {
    const l = log();
    const ref = { source: 'unsplash', id: 'abc' };
    const getRecord = vi.fn(async () => ({ description: 'ocean waves' }));
    const linked = await wallpaperSuggestion({ ref, state: { ...base, links: { 'unsplash:abc': 'fireside' } }, getRecord, log: l });
    expect(linked).toMatchObject({ sceneId: 'fireside', body: expect.stringMatching(/Play Fireside/) });
    expect(getRecord).not.toHaveBeenCalled();
    expect(await wallpaperSuggestion({ ref, state: { ...base, links: { 'unsplash:abc': 'fireside' } }, getRecord, log: l })).toBeNull();
    const matched = await wallpaperSuggestion({ ref, state: { ...base, status: 'playing', session: true }, getRecord, log: l });
    expect(matched).toMatchObject({ sceneId: 'ocean-meditation', body: expect.stringMatching(/Switch to Ocean Meditation/) });
  });

  it('stays quiet when off, during a focus session, or when already there', async () => {
    const getRecord = async () => ({ description: 'forest' });
    const ref = { source: 'local', id: 3 };
    expect(await wallpaperSuggestion({ ref, state: { ...base, suggest: { wallpaper: false } }, getRecord, log: log() })).toBeNull();
    expect(await wallpaperSuggestion({ ref, state: { ...base, focus: { status: 'running' } }, getRecord, log: log() })).toBeNull();
    expect(await wallpaperSuggestion({ ref, state: { ...base, sceneId: 'forest-escape', session: true }, getRecord, log: log() })).toBeNull();
  });

  it('suggests by local time, once per part of the day, and only when switched on', () => {
    const l = log();
    const evening = new Date(2026, 10, 12, 19, 30);
    expect(timeSuggestion({ state: { ...base, suggest: { time: false } }, date: evening, log: l })).toBeNull();
    expect(timeSuggestion({ state: base, date: evening, log: l })).toMatchObject({ sceneId: 'rainy-reading', title: 'Good evening' });
    expect(timeSuggestion({ state: base, date: new Date(2026, 10, 12, 20, 50), log: l })).toBeNull();
    expect(timeSuggestion({ state: base, date: new Date(2026, 10, 12, 23, 0), log: l })).toMatchObject({ sceneId: 'late-night' });
    expect([4, 5, 11, 12, 16, 17, 20, 21].map((h) => timeSlot(new Date(2026, 0, 1, h)))).toEqual(
      ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night'],
    );
    expect(msToNextSlot(new Date(2026, 0, 1, 16, 30))).toBe(30 * 60000);
    expect(msToNextSlot(new Date(2026, 0, 1, 22, 0))).toBe(7 * 3600000);
  });

  it('posts a notification for this tab’s wallpaper changes, never playing anything', async () => {
    const notify = vi.fn();
    let wallpaperHandler;
    const store = new Map([['iweb:ambienceUsed', '1']]);
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const play = vi.spyOn(engine, 'play');
    const stop = startSuggestions({
      engine,
      notify,
      storage,
      sceneEvent: 'atmosphere:scene',
      subscribeWallpaper: (h) => { wallpaperHandler = h; return () => {}; },
      getRecord: async () => ({ description: 'snowy cabin with a fireplace' }),
    });
    wallpaperHandler({ type: 'active-changed', payload: { source: 'local', id: 1 } }); // another tab's change
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).not.toHaveBeenCalled();
    wallpaperHandler({ type: 'active-changed', payload: { source: 'local', id: 1 }, local: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ app: 'atmosphere', action: { event: 'atmosphere:scene', detail: { sceneId: 'fireside' } } }));
    expect(play).not.toHaveBeenCalled();
    expect(made).toBe(0);
    stop();
  });

  it('waits until Atmosphere has been used before suggesting for wallpapers', async () => {
    const notify = vi.fn();
    let handler;
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const stop = startSuggestions({
      engine, notify, storage, sceneEvent: 'x',
      subscribeWallpaper: (h) => { handler = h; return () => {}; },
      getRecord: async () => ({ description: 'forest' }),
    });
    handler({ type: 'active-changed', payload: { source: 'local', id: 2 }, local: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).not.toHaveBeenCalled();
    await engine.play();
    expect(store.get('iweb:ambienceUsed')).toBe('1');
    stop();
  });
});

describe('Volume', () => {
  it('keeps the perceptual curve', () => {
    expect(volumeGain(1)).toBeCloseTo(0.9);
    expect(volumeGain(0.5)).toBeCloseTo(0.225);
  });
});
