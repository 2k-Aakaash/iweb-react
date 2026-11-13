// Frontier World, phase 2: the world clock (time and weather moving by themselves), the
// experience modes, the ambience and music volumes, Event and Weather Intensity, the event
// budget, answering calls, fog, fixed places in the stereo field, Frontier Radio's songs and
// the lite mode. The audio clock is the fake's (fakeAudio.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbienceEngine } from '../engine.js';
import { environmentById } from '../environments/index.js';
import { locationById, regionById } from '../frontier/catalogue.js';
import { NEIGHBOURS } from '../frontier/conditions.js';
import { budgetMax, createBudget, createDirector, eventGap, EVENTS } from '../frontier/events.js';
import { placeOf } from '../frontier/environments.js';
import { barNotes, createMusic, MOODS } from '../frontier/music.js';
import { eventFactor, weatherFactor } from '../frontier/sounds.js';
import { clockLabel, createWorld, phaseAt, phaseMiddle, phaseProgress, stepWorld } from '../frontier/world.js';
import { createKit } from '../voices.js';
import { normalizeSettings } from '../prefs.js';
import { seeded } from '../random.js';
import { FakeAudioContext, memoryPref } from './fakeAudio.js';

let ctx;
let engine;
let clockMs;

function makeEngine(settings = {}) {
  clockMs = new Date(2026, 10, 13, 6, 30).getTime(); // 6:30 in the morning: dawn
  return new AmbienceEngine({
    createContext: () => {
      ctx = new FakeAudioContext();
      return ctx;
    },
    settingsPref: memoryPref(normalizeSettings(settings)),
    scenesPref: memoryPref([]),
    sessionStore: memoryPref(null),
    channel: null,
    now: () => clockMs,
  });
}

/** Moves the audio clock and the timers on by `seconds`, a second at a time. */
async function play(seconds) {
  for (let i = 0; i < seconds; i += 1) {
    ctx.advance(1);
    clockMs += 1000;
    await vi.advanceTimersByTimeAsync(250);
  }
}

const levelOf = (layerId) => engine.current.inst.levels[layerId].gain;
const kitFor = (c, seed = 3) => createKit({ ctx: c, out: c.createGain(), sends: { reverb: c.createGain(), delay: c.createGain() }, buffers: new Map(), rng: seeded(seed), maxVoices: 28 });

beforeEach(() => {
  vi.useFakeTimers();
  engine = makeEngine();
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

// ---- The world clock (pure) ------------------------------------------------------------

describe('World clock', () => {
  const plains = locationById('fr-golden-mile');
  const weather = regionById('plains').weather;
  const base = { regionId: 'plains', regionWeather: weather, location: plains, now: 0 };

  it('knows the phases of the day', () => {
    expect([phaseAt(0), phaseAt(330), phaseAt(600), phaseAt(800), phaseAt(1100), phaseAt(1300)]).toEqual(['night', 'dawn', 'morning', 'afternoon', 'dusk', 'night']);
    expect(phaseProgress(300)).toBe(0);
    expect(phaseProgress(375)).toBeCloseTo(0.5);
    expect(phaseAt(phaseMiddle('dusk'))).toBe('dusk');
    expect(clockLabel(6 * 60 + 5)).toBe('6:05');
  });

  it('runs accelerated at its speed, and says when the phase changes', () => {
    let w = createWorld({ conditions: { time: 'morning', weather: 'clear' }, timeMode: 'accelerated', regionWeather: weather, now: 0, rng: seeded(1) });
    expect(w.clock).toBe(phaseMiddle('morning'));
    let changed = null;
    for (let i = 0; i < 60 && !changed; i += 1) {
      const s = stepWorld(w, { ...base, seconds: 60, timeMode: 'accelerated', speed: 6, weatherMode: 'locked', rng: seeded(i) });
      w = s.world;
      changed = s.time;
    }
    expect(changed).toBe('afternoon'); // 135 simulated minutes at 6×: a little over 22 real minutes
  });

  it('follows the device’s clock, and holds a fixed hour', () => {
    const dusk = new Date(2026, 10, 13, 18, 10).getTime();
    const w = createWorld({ conditions: { time: 'morning', weather: 'clear' }, timeMode: 'local', regionWeather: weather, now: dusk, rng: seeded(1) });
    expect(phaseAt(w.clock)).toBe('dusk');
    const fixed = stepWorld(w, { ...base, seconds: 600, timeMode: 'fixed', speed: 24, weatherMode: 'locked', rng: seeded(2) });
    expect(fixed.world.clock).toBe(w.clock);
    expect(fixed.time).toBeNull();
  });

  it('keeps each weather for at least its dwell, moves only to neighbours, and announces rain', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const rng = seeded(seed);
      let w = createWorld({ conditions: { time: 'afternoon', weather: 'clear' }, timeMode: 'fixed', regionWeather: weather, now: 0, rng });
      let since = 0;
      let current = 'clear';
      let announced = null;
      for (let minute = 1; minute <= 2000; minute += 1) {
        const s = stepWorld(w, { ...base, seconds: 60, timeMode: 'fixed', speed: 6, weatherMode: 'simulated', rng });
        w = s.world;
        since += 1;
        if (s.cues.length) {
          expect(s.cues[0].type).toBe('front');
          announced = { weather: s.cues[0].weather, at: minute };
        }
        if (s.weather) {
          expect(NEIGHBOURS[current]).toContain(s.weather);
          expect(weather.allowed).toContain(s.weather);
          // A front arrives a few minutes after it's announced; anything else after its dwell.
          if (announced && announced.weather === s.weather) expect(minute - announced.at).toBeGreaterThanOrEqual(3);
          else expect(since).toBeGreaterThanOrEqual(weather.dwell[0] * 0.5);
          if (['light-rain', 'heavy-rain', 'thunderstorm'].includes(s.weather) && !['light-rain', 'heavy-rain', 'thunderstorm'].includes(current)) expect(announced?.weather).toBe(s.weather);
          current = s.weather;
          since = 0;
          announced = null;
        }
      }
    }
  });

  it('never changes a locked weather', () => {
    let w = createWorld({ conditions: { time: 'afternoon', weather: 'fog' }, timeMode: 'fixed', regionWeather: weather, now: 0, rng: seeded(4) });
    for (let i = 0; i < 500; i += 1) {
      const s = stepWorld(w, { ...base, seconds: 600, timeMode: 'accelerated', speed: 24, weatherMode: 'locked', rng: seeded(i) });
      expect(s.weather).toBeNull();
      w = s.world;
    }
  });
});

// ---- The engine's world ----------------------------------------------------------------

describe('Engine: the world moving', () => {
  it('runs the hour on while playing, never while paused, and shows the clock', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.setSpeed(24);
    engine.setTimeMode('accelerated');
    await play(2);
    const start = engine.state.conditions.clock;
    expect(start).not.toBeNull();
    expect(engine.state.conditions.time).toBe('afternoon');
    await play(600); // 10 real minutes at 24×: four simulated hours
    expect(engine.state.conditions.clock - start).toBeGreaterThan(200);
    expect(engine.state.conditions.time).toBe('dusk');
    expect(engine.diagnostics().frontier.conditions.time).toBe('dusk');
    engine.pause();
    const held = engine.state.conditions.clock;
    await play(300);
    expect(engine.state.conditions.clock).toBe(held);
  });

  it('follows the device’s clock; choosing an hour locks it there', async () => {
    await engine.openLocation('fr-golden-mile');
    engine.setTimeMode('local');
    expect(engine.state.conditions).toMatchObject({ time: 'dawn', source: 'dynamic' });
    expect(engine.state.conditions.progress).toBeGreaterThan(0.3);
    engine.setConditions({ time: 'night' });
    expect(engine.state.frontier.timeMode).toBe('fixed');
    expect(engine.state.conditions.time).toBe('night');
  });

  it('switching to Fixed or Locked keeps what was showing', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.setSpeed(24);
    engine.setWorldModes({ timeMode: 'accelerated', weatherMode: 'simulated' });
    await play(900);
    const shown = { ...engine.state.conditions };
    engine.setWorldModes({ timeMode: 'fixed', weatherMode: 'locked' });
    expect(engine.state.conditions).toMatchObject({ time: shown.time, weather: shown.weather });
    expect(engine.state.frontier).toMatchObject({ time: shown.time, weather: shown.weather });
  });

  it('sends a storm front to the place before the rain arrives', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    const cue = vi.spyOn(engine.current.inst, 'cue');
    engine.worldRng = seeded(5); // a known sky: rain arrives within the first two hours
    engine.setSpeed(24);
    engine.setWorldModes({ timeMode: 'accelerated', weatherMode: 'simulated' });
    let rain = null;
    for (let i = 0; i < 240 && !rain; i += 1) {
      await play(30);
      if (['light-rain', 'heavy-rain', 'thunderstorm'].includes(engine.state.conditions.weather)) rain = engine.state.conditions.weather;
    }
    expect(rain).not.toBeNull();
    expect(cue).toHaveBeenCalledWith(expect.objectContaining({ type: 'front' }));
  });
});

describe('Engine: a place that can’t start', () => {
  it('says so, and the next place still plays', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    const env = environmentById('fr-heron-reach');
    const create = env.create;
    env.create = () => { throw new Error('test: a layer is missing'); };
    try {
      engine.openLocation('fr-heron-reach');
      expect(engine.state.notice).toMatch(/couldn’t start/);
      expect(engine.current).toBeNull();
    } finally {
      env.create = create;
    }
    await play(5);
    engine.openLocation('fr-cypress-bend');
    expect(engine.current?.env.id).toBe('fr-cypress-bend');
    expect(engine.state.notice).toBeNull();
    await play(20); // the faded-out place is disposed a few seconds later
    expect(engine.diagnostics().instances).toBe(1);
  });
});

// ---- Modes and volumes -----------------------------------------------------------------

describe('Experience modes and volumes', () => {
  it('Radio puts the music first: ambience stepped back, the radio volume, a crossfade', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    const full = levelOf('wind').value;
    engine.setMode('radio');
    expect(levelOf('wind').target).toBeCloseTo(full * 0.35, 5);
    const crossfade = levelOf('wind').events.filter((e) => e[0] === 'target').pop();
    expect(crossfade[3]).toBe(0.8); // a ≈ 2.5 s crossfade, never a cut
    const info = engine.diagnostics().frontier.music;
    expect(info).toMatchObject({ enabled: true, radio: true });
    engine.setMode('environmental');
    expect(levelOf('wind').target).toBeCloseTo(full, 5);
    expect(engine.diagnostics().frontier.music.enabled).toBe(false);
  });

  it('keeps a music volume for each mode, and an ambience volume of its own', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.setMode('cinematic');
    engine.setMusic({ volume: 0.3 });
    engine.setMode('radio');
    engine.setMusic({ volume: 0.9 });
    expect(engine.state.frontier.music).toMatchObject({ cinematicVolume: 0.3, radioVolume: 0.9 });
    engine.setMode('environmental');
    const full = levelOf('grass').value;
    engine.setAmbienceVolume(0.5);
    expect(levelOf('grass').target).toBeCloseTo(full * 0.5, 5);
    // Muting and the mix still work under it.
    engine.setLayerVolume('grass', 0.2);
    expect(levelOf('grass').target).toBeCloseTo(0.2 * 0.5 * environmentById('fr-golden-mile').layers.find((l) => l.id === 'grass').scale, 5);
  });

  it('applies Event and Weather Intensity to the playing place', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.setEventIntensity(1);
    engine.setWeatherIntensity(0.2);
    expect(engine.diagnostics().frontier.tune).toMatchObject({ eventIntensity: 1, weatherIntensity: 0.2 });
    expect(engine.state.frontier).toMatchObject({ eventIntensity: 1, weatherIntensity: 0.2 });
    expect([eventFactor(0), eventFactor(0.5), eventFactor(1)]).toEqual([0.3, 1, 1.7]);
    expect(weatherFactor(0.5)).toBe(1);
    const rng = seeded(1);
    const busy = Array.from({ length: 50 }, () => eventGap(rng, 0.45, 1)).reduce((a, b) => a + b);
    const calm = Array.from({ length: 50 }, () => eventGap(rng, 0.45, 0)).reduce((a, b) => a + b);
    expect(calm).toBeGreaterThan(busy * 3);
  });

  it('goes lite after a long while hidden, and back', async () => {
    await engine.openLocation('fr-golden-mile', { play: true });
    engine.hiddenSince = clockMs - 61000;
    engine.updateLite();
    expect(engine.state.lite).toBe(true);
    expect(engine.diagnostics().frontier.tune.lite).toBe(true);
    engine.hiddenSince = null;
    engine.updateLite();
    expect(engine.state.lite).toBe(false);
  });
});

// ---- Events, fog and place -------------------------------------------------------------

describe('Living world', () => {
  it('budgets notable sounds: only so many may start together', () => {
    const b = createBudget({ max: () => budgetMax(0.5) });
    expect(budgetMax(0)).toBe(2);
    expect(budgetMax(1)).toBe(4);
    expect([b.take(10), b.take(10.5), b.take(11), b.take(11.5)]).toEqual([true, true, true, false]);
    expect(b.take(30)).toBe(true); // a later moment is free again
  });

  it('answers some calls from the other side, further off, and never stacks new ones', () => {
    const c = new FakeAudioContext();
    const kit = kitFor(c, 9);
    const layer = (kind) => {
      const l = kit.layer(0.5);
      return [kind, { gain: l.gain, api: { gustAt() {} } }];
    };
    const director = createDirector({ kit, pool: ['coyote', 'owl', 'gust'], layers: new Map(['wildlife', 'wind', 'birds'].map(layer)), rng: seeded(7) });
    director.setConditions({ time: 'night', weather: 'clear' }, {});
    const all = [];
    for (let t = 0; t < 7200; t += 1) {
      director.schedule(t, t + 1);
      for (const h of director.history()) if (!all.some((x) => x.at === h.at && x.id === h.id)) all.push(h);
    }
    const answers = all.filter((h) => h.answer);
    const calls = all.filter((h) => !h.answer);
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      const call = [...calls].reverse().find((h) => h.at < a.at);
      expect(call.id).toBe(a.id);
      expect(EVENTS[a.id].answer).toBeGreaterThan(0);
    }
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i].id).not.toBe(calls[i - 1].id);
      expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(10);
    }
    kit.dispose();
  });

  it('muffles distant sounds in fog', async () => {
    await engine.openLocation('fr-heron-reach', { play: true });
    const tone = engine.current.kit.layerOf(levelOf('birds') && engine.current.inst.levels.birds).tone;
    expect(engine.state.conditions.weather).toBe('fog');
    expect(tone.frequency.target).toBe(4200);
    engine.setConditions({ weather: 'clear' });
    expect(tone.frequency.target).toBe(18000);
  });

  it('puts each place’s sources in their own fixed spot', () => {
    const creek = { id: 'water', kind: 'water' };
    const a = placeOf('fr-alder-creek', creek).pos;
    expect(placeOf('fr-alder-creek', creek).pos).toBe(a);
    const spots = new Set(['fr-alder-creek', 'fr-pineglass-river', 'fr-dustwillow-wash', 'fr-blue-glacier-run'].map((id) => placeOf(id, creek).pos));
    expect(spots.size).toBeGreaterThan(2);
    for (const p of spots) expect(Math.abs(p)).toBeLessThanOrEqual(0.6);
    expect(placeOf('fr-alder-creek', { id: 'wind', kind: 'wind' }).pos).toBe(0); // all around: not placed
  });

  it('has distant cattle where there are cattle', () => {
    for (const id of ['fr-golden-mile', 'fr-windmill-ranch', 'fr-longhorn-meadow']) expect(locationById(id).events).toContain('cattle');
    expect(EVENTS.cattle.layers).toEqual(['distant']);
  });
});

// ---- Frontier Radio --------------------------------------------------------------------

describe('Frontier Radio', () => {
  it('writes a lead melody over the pattern', () => {
    const rng = seeded(5);
    const mood = MOODS['frontier-calm'];
    const { notes } = barNotes(mood, mood.chords[0], rng, null, { lead: true });
    expect(notes.some((n) => n.lead)).toBe(true);
    expect(barNotes(mood, mood.chords[0], seeded(5)).notes.some((n) => n.lead)).toBe(false);
  });

  it('plays songs in an A A′ B A shape, with hardly any rests', () => {
    const c = new FakeAudioContext();
    c.state = 'running';
    const kit = kitFor(c, 11);
    const music = createMusic(kit);
    music.set({ enabled: true, volume: 0.7, mood: 'long-ride', radio: true }, 0.05);
    const sections = [];
    for (let t = 0; t < 120; t += 0.5) {
      music.schedule(t, t + 0.9);
      const s = music.section();
      if (s && sections[sections.length - 1] !== s) sections.push(s);
      c.advance(0.5);
    }
    expect(sections.slice(0, 4)).toEqual(['A', 'A2', 'B', 'A']);
    expect(music.radio()).toBe(true);
    kit.dispose();
  });
});
