import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbienceEngine, volumeGain } from '../engine.js';
import { ENVIRONMENTS } from '../environments/index.js';
import { normalizePreset, normalizeSettings } from '../prefs.js';
import { FakeAudioContext, memoryPref } from './fakeAudio.js';

let ctx;
let engine;
let made;

function makeEngine(options = {}) {
  made = 0;
  return new AmbienceEngine({
    createContext: () => {
      made += 1;
      ctx = new FakeAudioContext(options.context);
      return ctx;
    },
    settingsPref: memoryPref(normalizeSettings({})),
    presetsPref: memoryPref([]),
    channel: null,
    ...options.engine,
  });
}

// Lets the audio clock run on with the fake timers.
async function advance(seconds) {
  for (let i = 0; i < seconds * 4; i += 1) {
    ctx.advance(0.25);
    await vi.advanceTimersByTimeAsync(250);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  engine = makeEngine();
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

describe('Atmosphere engine', () => {
  it('creates no audio until Play, and one context however often Play is pressed', async () => {
    expect(made).toBe(0);
    expect(engine.diagnostics().context).toBe('none');
    await Promise.all([engine.play(), engine.play(), engine.play()]);
    await engine.play();
    expect(made).toBe(1);
    expect(engine.getState().status).toBe('playing');
    expect(engine.diagnostics().instances).toBe(1);
  });

  it('plays, pauses (fading out, then suspending) and resumes', async () => {
    await engine.play();
    const master = engine.graph.master.gain;
    expect(master.target).toBeCloseTo(volumeGain(engine.getState().masterVolume));
    engine.pause();
    expect(engine.getState().status).toBe('paused');
    expect(master.target).toBe(0);
    expect(engine.diagnostics().ticking).toBe(false);
    await vi.advanceTimersByTimeAsync(700);
    expect(ctx.state).toBe('suspended');
    await engine.resume();
    expect(engine.getState().status).toBe('playing');
    expect(made).toBe(1);
  });

  it('stops: fades, then disposes every node of the environment', async () => {
    await engine.play();
    expect(engine.diagnostics().nodes).toBeGreaterThan(0);
    engine.stop();
    expect(engine.getState().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.diagnostics()).toMatchObject({ instances: 0, nodes: 0, voices: 0, ticking: false });
  });

  it('changes volume and layers with ramps, never jumps', async () => {
    await engine.play();
    engine.setMasterVolume(0.3);
    const events = engine.graph.master.gain.events;
    expect(events.at(-1)[0]).toBe('target');
    expect(events.at(-1)[1]).toBeCloseTo(volumeGain(0.3));
    engine.setLayerVolume('rain', 0.1);
    const rain = engine.current.inst.levels.rain.gain;
    expect(rain.events.at(-1)[0]).toBe('target');
    expect(engine.getState().layers.rain).toBe(0.1);
  });

  it('crossfades environments and leaves nothing behind after quick switching', async () => {
    await engine.play();
    const one = engine.diagnostics().nodes;
    for (const env of [...ENVIRONMENTS, ...ENVIRONMENTS]) engine.changeEnvironment(env.id);
    expect(engine.diagnostics().instances).toBeLessThanOrEqual(3); // current + at most 2 fading
    await advance(4);
    const after = engine.diagnostics();
    expect(after.instances).toBe(1);
    expect(engine.getState().status).toBe('playing');
    // Only the current environment's nodes are alive (none piling up).
    expect(after.nodes).toBeLessThan(one * 3);
  });

  it('makes each noise buffer once and reuses it during playback', async () => {
    await engine.play();
    await advance(20);
    const buffers = ctx.buffersMade;
    await advance(40);
    expect(ctx.buffersMade).toBe(buffers);
    expect(engine.diagnostics().buffers).toBeLessThanOrEqual(3);
  });

  it('keeps scheduled events bounded', async () => {
    engine.changeEnvironment('fireplace'); // the busiest: many crackles
    await engine.play();
    for (let i = 0; i < 10; i += 1) {
      await advance(6);
      // Only what's sounding right now: a lookahead's worth of crackles, never a growing pile.
      expect(engine.diagnostics().voices).toBeLessThan(40);
    }
  });

  it('randomizes without restarting or touching the volume', async () => {
    await engine.play();
    const instance = engine.current;
    const volume = engine.getState().masterVolume;
    engine.randomize();
    expect(engine.current).toBe(instance);
    expect(engine.getState()).toMatchObject({ status: 'playing', masterVolume: volume });
    expect(engine.getState().seed).not.toBeNull();
  });

  it('reports a blocked start honestly', async () => {
    engine.dispose();
    engine = makeEngine({ context: { failResume: true } });
    await engine.play();
    expect(engine.getState().status).toBe('error');
    expect(engine.getState().error).toMatch(/didn’t allow sound/);
  });

  it('says so when the browser suspends it mid-play', async () => {
    await engine.play();
    ctx.setState('suspended');
    expect(engine.getState()).toMatchObject({ status: 'paused', notice: expect.stringMatching(/browser/) });
  });

  it('runs a sleep timer that fades out and stops, and can be cancelled', async () => {
    await engine.play();
    engine.setSleepTimer(15);
    expect(engine.getState().sleep.minutes).toBe(15);
    engine.setSleepTimer(null);
    expect(engine.getState().sleep).toBeNull();
    engine.setSleepTimer(15);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 61 * 1000);
    expect(engine.getState().status).toBe('playing');
    await vi.advanceTimersByTimeAsync(62 * 1000);
    expect(engine.getState().status).toBe('idle');
  });

  it('saves and applies presets', async () => {
    await engine.play();
    engine.setParameter('mood', 0.9);
    engine.setLayerVolume('piano', 0.8);
    const preset = engine.savePreset('Late night');
    engine.setParameter('mood', 0.1);
    engine.applyPreset(preset);
    expect(engine.getState().params.mood).toBe(0.9);
    expect(engine.presetsPref.get().map((p) => p.name)).toEqual(['Late night']);
    engine.applyPreset({ ...preset, environmentId: 'deep-space' });
    await advance(1);
    expect(engine.getState().environmentId).toBe('deep-space');
  });

  it('pauses when another iWeb tab starts playing', async () => {
    const listeners = [];
    const channel = { postMessage: vi.fn(), close: vi.fn(), set onmessage(fn) { listeners.push(fn); } };
    engine.dispose();
    engine = makeEngine({ engine: { channel } });
    await engine.play();
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'play' }));
    listeners[0]({ data: { type: 'play', from: 'another-tab' } });
    expect(engine.getState()).toMatchObject({ status: 'paused', notice: expect.stringMatching(/another iWeb tab/) });
  });
});

describe('Atmosphere settings', () => {
  it('repairs damaged or old saved settings', () => {
    const fixed = normalizeSettings({ environmentId: 'nope', masterVolume: 7, environments: { 'rainy-mood': { layers: { rain: 'x' }, params: { mood: -1 } } } });
    expect(fixed.environmentId).toBe('rainy-mood');
    expect(fixed.masterVolume).toBe(1);
    expect(fixed.environments['rainy-mood'].layers.rain).toBe(0.75);
    expect(fixed.environments['rainy-mood'].params.mood).toBe(0);
    expect(normalizeSettings('junk')).toBeNull();
  });

  it('keeps only valid presets (read as scenes, which keep the master volume as it is)', () => {
    const scene = normalizePreset({ name: ' Focus ', environmentId: 'deep-space', masterVolume: 0.3, params: { mood: 0.2 } });
    expect(scene).toMatchObject({ name: 'Focus', environmentId: 'deep-space', version: 2, parameters: { mood: 0.2, evolutionMode: 'gentle' } });
    expect(scene).not.toHaveProperty('masterVolume');
    expect(normalizePreset({ name: '', environmentId: 'deep-space' })).toBeNull();
    expect(normalizePreset({ name: 'x', environmentId: 'mars' })).toBeNull();
  });

  it('defines every environment within five layers', () => {
    for (const env of ENVIRONMENTS) {
      expect(env.layers.length).toBeLessThanOrEqual(5);
      expect(new Set(env.layers.map((l) => l.id)).size).toBe(env.layers.length);
    }
  });
});
